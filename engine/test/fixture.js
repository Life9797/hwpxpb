// 시험용 최소 HWPX 생성기. 실제 한글 양식에서 본 구조를 그대로 흉내 낸다.
import { zipSync, strToU8 } from 'fflate';

const clickHere = (id, name, guide, content, { dirty = 0, sameRun = false } = {}) => {
  const begin =
    `<hp:ctrl><hp:fieldBegin id="${id}" type="CLICK_HERE" name="${name}" editable="1" dirty="${dirty}" zorder="-1" fieldid="1">` +
    `<hp:parameters cnt="2" name=""><hp:integerParam name="Prop">9</hp:integerParam>` +
    `<hp:stringParam name="Command" xml:space="preserve">Clickhere:set:40:Direction:wstring:${guide.length}:${guide} HelpState:wstring:0:  </hp:stringParam>` +
    `</hp:parameters></hp:fieldBegin></hp:ctrl>`;
  const end = `<hp:ctrl><hp:fieldEnd beginIDRef="${id}" fieldid="1"/></hp:ctrl>`;
  if (sameRun) return `<hp:run charPrIDRef="32">${begin}<hp:t>${content}</hp:t>${end}<hp:t/></hp:run>`;
  return (
    `<hp:run charPrIDRef="32">${begin}</hp:run>` +
    `<hp:run charPrIDRef="37"><hp:t>${content}</hp:t></hp:run>` +
    `<hp:run charPrIDRef="32">${end}<hp:t/></hp:run>`
  );
};

const formObj = (el, attrs, inner = '') =>
  `<hp:run charPrIDRef="0"><hp:${el} caption="${attrs.caption ?? ''}" value="${attrs.value ?? 'UNCHECKED'}" ` +
  `radioGroupName="${attrs.group ?? ''}" triState="0" backStyle="OPAQUE" name="${attrs.name}"` +
  (attrs.selectedValue != null ? ` selectedValue="${attrs.selectedValue}"` : '') +
  ` foreColor="#000000" backColor="#FFFFFF" groupName="" tabStop="1" tabOrder="1" enabled="1">` +
  `<hp:formCharPr charPrIDRef="0" followContext="0" autoSz="0" wordWrap="0"/>${inner}` +
  `<hp:sz width="1000" widthRelTo="ABSOLUTE" height="800" heightRelTo="ABSOLUTE" protect="0"/></hp:${el}><hp:t/></hp:run>`;

const para = (body) =>
  `<hp:p id="0" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">${body}` +
  `<hp:linesegarray><hp:lineseg textpos="0" vertpos="0" vertsize="1000" textheight="1000" baseline="850" spacing="600" horzpos="0" horzsize="7280" flags="393216"/></hp:linesegarray></hp:p>`;

export function makeHwpx({ keyword = 'dbtable=TB_TEST' } = {}) {
  const section =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>' +
    '<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">' +
    para('<hp:run charPrIDRef="0"><hp:t>성명: </hp:t></hp:run>' + clickHere(101, 'PT_NM', '성명', ' 성명')) +
    para(clickHere(102, 'RESULT', '판정', '정상', { dirty: 1, sameRun: true })) +
    para(clickHere(103, 'MEMO', '메모', '')) +
    para(formObj('checkBtn', { name: 'AGREE_YN' })) +
    para(formObj('checkBtn', { name: 'ITEM_CD__01' }) + formObj('checkBtn', { name: 'ITEM_CD__02' })) +
    para(
      formObj('radioBtn', { name: 'M', caption: '남', group: 'SEX_CD', value: 'CHECKED' }) +
        formObj('radioBtn', { name: 'F', caption: '여', group: 'SEX_CD' }),
    ) +
    para(
      formObj(
        'comboBox',
        { name: 'REGION_CD', selectedValue: '' },
        '<hp:listItem displayText="" value="01:서울"/><hp:listItem displayText="" value="02:부산"/><hp:listItem displayText="" value="03|대구"/>',
      ),
    ) +
    '</hs:sec>';
  const hpf =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?><opf:package xmlns:opf="http://www.idpf.org/2007/opf/"><opf:metadata>' +
    `<opf:title/><opf:meta name="keyword" content="text">${keyword}</opf:meta></opf:metadata></opf:package>`;
  return zipSync({
    mimetype: [strToU8('application/hwp+zip'), { level: 0 }],
    'version.xml': strToU8('<?xml version="1.0"?><hv:HCFVersion xmlns:hv="x"/>'),
    'Contents/content.hpf': strToU8(hpf),
    'Contents/header.xml': strToU8('<?xml version="1.0"?><hh:head xmlns:hh="x"/>'),
    'Contents/section0.xml': strToU8(section),
  });
}
