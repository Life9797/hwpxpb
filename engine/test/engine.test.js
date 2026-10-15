import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'fflate';
import { HwpxDocument } from '../src/index.js';
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
