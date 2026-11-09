import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'fflate';
import { HwpxDocument, replaceText } from '../src/index.js';
import { makeHwpx } from './fixture.js';

const open = () => new HwpxDocument(makeHwpx());

test('schema: 누름틀·체크박스·라디오·드롭다운을 모두 찾는다', () => {
  const s = open().schema();
  const byName = Object.fromEntries(s.map((x) => [x.name, x]));
  assert.equal(byName.PT_NM.type, 'clickhere');
  assert.equal(byName.PT_NM.guide, '성명');
  assert.equal(byName.AGREE_YN.type, 'checkbox');
  assert.equal(byName.M.group, 'SEX_CD');
  assert.deepEqual(byName.REGION_CD.items, ['01:서울', '02:부산', '03|대구']);
});

test('extract: 빈 양식은 안내문 대신 빈 값, dirty 누름틀은 내용을 돌려준다', () => {
  const r = open().extract();
  assert.equal(r.table, 'TB_TEST');
  assert.deepEqual(r.values, {
    PT_NM: '',
    RESULT: '정상',
    MEMO: '',
    AGREE_YN: 'N',
    ITEM_CD: '',
    SEX_CD: 'M',
    REGION_CD: '',
  });
});

test('fill → extract 왕복', () => {
  const doc = open();
  const res = doc.fill({
    PT_NM: '홍<길>동 & "1"',
    MEMO: '첫줄\n둘째줄',
    AGREE_YN: 'Y',
    ITEM_CD: '02',
    SEX_CD: 'F',
    REGION_CD: '02',
    NOPE: 'x',
  });
  assert.deepEqual(res, {
    applied: ['AGREE_YN', 'ITEM_CD', 'MEMO', 'PT_NM', 'REGION_CD', 'SEX_CD'],
    unknown: ['NOPE'],
    rejected: [],
  });
  const again = new HwpxDocument(doc.toBytes()).extract();
  assert.deepEqual(again.values, {
    PT_NM: '홍<길>동 & "1"',
    RESULT: '정상',
    MEMO: '첫줄\n둘째줄',
    AGREE_YN: 'Y',
    ITEM_CD: '02',
    SEX_CD: 'F',
    REGION_CD: '02',
  });
});

test('드롭다운: 목록에 없는 코드와 없는 라디오 값은 넣지 않고 rejected', () => {
  const doc = open();
  const res = doc.fill({ REGION_CD: '99', SEX_CD: 'X' });
  assert.deepEqual(res.rejected, ['REGION_CD', 'SEX_CD']);
  assert.equal(doc.extract().values.SEX_CD, 'M'); // 원래 선택 유지
});

test('드롭다운 구분자를 호출 때 지정할 수 있다', () => {
  const doc = open();
  assert.deepEqual(doc.fill({ REGION_CD: '03' }, { comboSep: '|' }).applied, ['REGION_CD']);
  assert.equal(doc.extract({ comboSep: '|' }).values.REGION_CD, '03');
  assert.equal(doc.extract({ comboSep: ':' }).values.REGION_CD, '03|대구');
});

test('값 이외의 XML 은 바뀌지 않는다', () => {
  const src = makeHwpx();
  const doc = new HwpxDocument(src);
  doc.fill({ AGREE_YN: 'Y' });
  const before = strFromU8(unzipSync(src)['Contents/section0.xml']);
  const after = strFromU8(unzipSync(doc.toBytes())['Contents/section0.xml']);
  assert.equal(after, before.replace('value="UNCHECKED" radioGroupName="" triState="0" backStyle="OPAQUE" name="AGREE_YN"', 'value="CHECKED" radioGroupName="" triState="0" backStyle="OPAQUE" name="AGREE_YN"'));
  const out = unzipSync(doc.toBytes());
  assert.equal(Object.keys(out)[0], 'mimetype');
  for (const n of ['version.xml', 'Contents/content.hpf', 'Contents/header.xml']) {
    assert.deepEqual(out[n], unzipSync(src)[n]);
  }
});

test('HWPX 가 아니면 오류', () => {
  assert.throws(() => new HwpxDocument(new Uint8Array([1, 2, 3])));
});

test('빈 칸의 안내문(빨간 글씨 등)은 지우고 값은 누름틀 글자 모양으로 넣는다', () => {
  const doc = open();
  doc.fill({ PT_NM: '홍길동', RESULT: '이상' });
  const xml = strFromU8(unzipSync(doc.toBytes())['Contents/section0.xml']);
  // 안내문 run(charPr 37)은 비고, 값은 fieldBegin 이 있는 run(charPr 32)에 들어간다
  assert.match(xml, /name="PT_NM"[^>]*>[\s\S]*?<\/hp:fieldBegin><\/hp:ctrl><hp:t>홍길동<\/hp:t><\/hp:run><hp:run charPrIDRef="37"><hp:t\/><\/hp:run>/);
  assert.ok(!xml.includes(' 성명</hp:t>'));
  // 이미 입력돼 있던 칸은 그 자리(글자 모양)에 바꿔 넣는다
  assert.match(xml, /<hp:t>이상<\/hp:t><hp:ctrl><hp:fieldEnd beginIDRef="102"/);
});

test('빈 칸에 빈 값을 넣으면 아무것도 바뀌지 않는다 (추출값을 다시 넣어도 원본과 같다)', () => {
  const src = makeHwpx();
  const doc = new HwpxDocument(src);
  doc.fill(doc.extract().values);
  assert.equal(strFromU8(unzipSync(doc.toBytes())['Contents/section0.xml']), strFromU8(unzipSync(src)['Contents/section0.xml']));
});

test('hideGuides: 빈 칸의 안내문만 지우고 입력된 값은 둔다 (출력용)', () => {
  const doc = open();
  doc.fill({ MEMO: '메모' });
  doc.hideGuides();
  const xml = strFromU8(unzipSync(doc.toBytes())['Contents/section0.xml']);
  assert.ok(!xml.includes(' 성명</hp:t>'));
  assert.ok(xml.includes('Direction:wstring:2:   HelpState:')); // 길이 표기는 그대로, 글자만 공백
  const v = new HwpxDocument(doc.toBytes()).extract().values;
  assert.equal(v.RESULT, '정상');
  assert.equal(v.MEMO, '메모');
  assert.equal(v.PT_NM, '');
});

test('columns: 문서 순서와 넣은 순서(누름틀 id 순 → 양식 개체 tabOrder 순)', () => {
  const d = open();
  const doc = d.columns();
  const created = d.columns('created');
  assert.deepEqual([...created].sort(), [...doc].sort());
  const kinds = new Map(d.schema().map((x) => [x.type === 'radio' ? x.group : x.name.split('__')[0], x.type]));
  const firstForm = created.findIndex((c) => kinds.get(c) !== 'clickhere');
  assert.ok(created.slice(firstForm).every((c) => kinds.get(c) !== 'clickhere'));
});

test('누름틀 묶음: 컬럼__x 누름틀은 컬럼 하나로 묶어 "|" 로 잇고, 대입할 때 나눠 넣는다', () => {
  const doc = new HwpxDocument(makeHwpx({ group: true }));
  assert.equal(doc.extract().values.ADDR, '|강남구|');
  assert.deepEqual(doc.columns('created').slice(0, 4), ['PT_NM', 'RESULT', 'MEMO', 'ADDR']);
  // 조각이 칸보다 많으면 마지막 칸에 나머지를 그대로 넣는다. 쉼표는 값의 일부
  const res = doc.fill({ ADDR: '서울시|서초구|반포대로 1, 101호|별관' });
  assert.deepEqual(res, { applied: ['ADDR'], unknown: [], rejected: [] });
  const raw = new HwpxDocument(doc.toBytes()).extractRaw();
  assert.equal(raw.ADDR__1, '서울시');
  assert.equal(raw.ADDR__2, '서초구');
  assert.equal(raw.ADDR__3, '반포대로 1, 101호|별관');
  // 조각이 모자라면 남은 칸은 비운다, 개체 이름(ADDR__1)은 컬럼이 아니다
  const r2 = doc.fill({ ADDR: '부산시', ADDR__1: 'x' });
  assert.deepEqual(r2, { applied: ['ADDR'], unknown: ['ADDR__1'], rejected: [] });
  assert.equal(new HwpxDocument(doc.toBytes()).extract().values.ADDR, '부산시||');
  doc.fill({ ADDR: '' });
  assert.equal(new HwpxDocument(doc.toBytes()).extract().values.ADDR, '');
  // 구분자 지정
  doc.fill({ ADDR: '대구,중구,동성로' }, { groupSep: ',' });
  assert.equal(new HwpxDocument(doc.toBytes()).extract().values.ADDR, '대구|중구|동성로');
  assert.equal(new HwpxDocument(doc.toBytes()).extract({ groupSep: ',' }).values.ADDR, '대구,중구,동성로');
});

test('extract: 에디터에서 직접 입력해 dirty="0" 인 채로 저장된 누름틀도 값을 돌려준다', () => {
  const doc = new HwpxDocument(makeHwpx());
  const name = 'Contents/section0.xml';
  // rhwp 는 입력해도 dirty 를 안 바꾸고 안내문 자리에 값을 쓴다
  const xml = strFromU8(doc.entries[name]).replace('<hp:t> 성명</hp:t>', '<hp:t>KIM</hp:t>');
  doc.entries[name] = new TextEncoder().encode(xml);
  const values = doc.extract().values;
  assert.equal(values.PT_NM, 'KIM');
  assert.equal(values.MEMO, '');
  // 인쇄용 안내문 지우기에서 입력값이 지워지지 않는다
  assert.match(strFromU8(doc.hideGuides().entries[name]), /<hp:t>KIM<\/hp:t>/);
});

test('replaceText: XML 전체 일괄 치환, wstring 길이 보정, 함수 호출형', () => {
  const doc = open();
  doc.entries['Contents/section0.xml'] = new TextEncoder().encode(
    new TextDecoder().decode(doc.entries['Contents/section0.xml']) + '<x a="ptinfo">Name:wstring:9:ptinfo_nm z</x>');
  doc.replaceText({ ptinfo: 'ptif', '': 'x' });
  const xml = doc.xml('Contents/section0.xml');
  assert.ok(!xml.includes('ptinfo'));
  assert.ok(xml.includes('<x a="ptif">Name:wstring:7:ptif_nm z</x>'));
  assert.equal(doc.replaced, 2);
  const out = new HwpxDocument(replaceText(doc.toBytes(), { ptif: '홍' }));
  assert.ok(out.xml('Contents/section0.xml').includes('Name:wstring:4:홍_nm z'));
  assert.equal(out.extract().values.RESULT, '정상');
});
