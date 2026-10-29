$PBExportHeader$w_hwpx_demo.srw
$PBExportComments$HWPX 양식 OCX 예제: 파일 열기, DW → 문서 값 대입, 문서 → DW 값 추출
forward
global type w_hwpx_demo from window
end type
type sle_file from singlelineedit within w_hwpx_demo
end type
type cb_browse from commandbutton within w_hwpx_demo
end type
type cb_open from commandbutton within w_hwpx_demo
end type
type cbx_edit from checkbox within w_hwpx_demo
end type
type ddlb_mode from dropdownlistbox within w_hwpx_demo
end type
type cb_fill from commandbutton within w_hwpx_demo
end type
type cb_extract from commandbutton within w_hwpx_demo
end type
type cb_makedw from commandbutton within w_hwpx_demo
end type
type cb_save from commandbutton within w_hwpx_demo
end type
type cb_print from commandbutton within w_hwpx_demo
end type
type st_status from statictext within w_hwpx_demo
end type
type cb_close from commandbutton within w_hwpx_demo
end type
type ddlb_printer from dropdownlistbox within w_hwpx_demo
end type
type cb_selprinter from commandbutton within w_hwpx_demo
end type
type dw_1 from datawindow within w_hwpx_demo
end type
end forward

global type w_hwpx_demo from window
integer width = 4400
integer height = 2700
boolean titlebar = true
string title = "HWPX 양식 예제"
boolean controlmenu = true
boolean minbox = true
boolean maxbox = true
boolean resizable = true
long backcolor = 67108864
string icon = "AppIcon!"
boolean center = true
event ue_ready ( )
sle_file sle_file
cb_browse cb_browse
cb_open cb_open
cbx_edit cbx_edit
ddlb_mode ddlb_mode
cb_fill cb_fill
cb_extract cb_extract
cb_makedw cb_makedw
cb_save cb_save
cb_print cb_print
st_status st_status
cb_close cb_close
ddlb_printer ddlb_printer
cb_selprinter cb_selprinter
dw_1 dw_1
end type
global w_hwpx_demo w_hwpx_demo

type variables
// 창에 놓은 OLE 컨트롤 (Insert > OLE > Insert Control > HwpxEditorControl). 이름은 아무것이나 된다
OLECustomControl iole
boolean ib_ready
long il_wait        // 준비를 기다린 횟수 (timer 0.3 초마다)
string is_file      // 열 파일. OpenWithParm 인수나 실행 인수(CommandParm)로 받는다
string is_sep = ""  // 드롭다운 코드 구분자. "" 이면 ":" ("01:서울" → 값 01)
end variables

forward prototypes
public function boolean wf_check ()
public function boolean wf_open (string as_file)
public function string wf_replace_all (string as_src, string as_old, string as_new)
public function string wf_json (string as_text)
public function string wf_getitem (long al_row, string as_col)
public function integer wf_setitem (long al_row, string as_col, string as_val)
public function integer wf_dw_to_doc ()
public function integer wf_doc_to_dw ()
public function integer wf_make_dw ()
public subroutine wf_layout ()
public subroutine wf_load_printers ()
end prototypes

event ue_ready();// 에디터 준비 완료 (timer 에서 IsReady 를 보고 부른다)
ib_ready = True
iole.object.AllowEdit = cbx_edit.Checked
st_status.Text = "에디터 준비됨"
wf_load_printers()
If is_file <> "" Then wf_open(is_file)
end event

public function boolean wf_check ();If Not IsValid(iole) Then
	MessageBox("예제", "창에 OLE 컨트롤(HwpxEditorControl)을 놓아 주세요")
	Return False
End If
If Not ib_ready Then
	MessageBox("예제", "에디터가 아직 준비되지 않았습니다. 잠시 후 다시 누르세요")
	Return False
End If
Return True
end function

public function boolean wf_open (string as_file);// 파일 열기. 작성(form) / 편집(edit, AllowEdit 필요)
string ls_mode = "form"

If Not wf_check() Then Return False
If Trim(as_file) = "" Then Return False
If cbx_edit.Checked And ddlb_mode.Text = "편집" Then ls_mode = "edit"

If Not iole.object.Open(as_file, ls_mode) Then
	MessageBox("열기 실패", String(iole.object.LastError))
	Return False
End If
is_file = as_file
sle_file.Text = as_file
st_status.Text = "열림 - 테이블: " + String(iole.object.GetTable())
Return True
end function

public function string wf_replace_all (string as_src, string as_old, string as_new);long ll_pos

ll_pos = Pos(as_src, as_old)
Do While ll_pos > 0
	as_src = Replace(as_src, ll_pos, Len(as_old), as_new)
	ll_pos = Pos(as_src, as_old, ll_pos + Len(as_new))
Loop
Return as_src
end function

public function string wf_json (string as_text);// JSON 문자열 "..." 로 감싼다
If IsNull(as_text) Then as_text = ""
as_text = wf_replace_all(as_text, "\", "\\")
as_text = wf_replace_all(as_text, '"', '\"')
as_text = wf_replace_all(as_text, "~r", "\r")
as_text = wf_replace_all(as_text, "~n", "\n")
as_text = wf_replace_all(as_text, "~t", "\t")
Return '"' + as_text + '"'
end function

public function string wf_getitem (long al_row, string as_col);// DW 값을 문자열로 (문서에 넣을 값)
string ls_type, ls_val

ls_type = Lower(dw_1.Describe(as_col + ".ColType"))
Choose Case True
	Case Left(ls_type, 4) = "char"
		ls_val = dw_1.GetItemString(al_row, as_col)
	Case ls_type = "date"
		ls_val = String(dw_1.GetItemDate(al_row, as_col), "yyyy-mm-dd")
	Case Left(ls_type, 8) = "datetime" Or ls_type = "timestamp"
		ls_val = String(dw_1.GetItemDateTime(al_row, as_col), "yyyy-mm-dd hh:mm")
	Case ls_type = "time"
		ls_val = String(dw_1.GetItemTime(al_row, as_col), "hh:mm")
	Case Left(ls_type, 7) = "decimal"
		ls_val = String(dw_1.GetItemDecimal(al_row, as_col))
	Case Else
		ls_val = String(dw_1.GetItemNumber(al_row, as_col))
End Choose
If IsNull(ls_val) Then ls_val = ""
Return ls_val
end function

public function integer wf_setitem (long al_row, string as_col, string as_val);// 문서 값(문자열)을 DW 컬럼 형식에 맞춰 넣는다
string ls_type
date ld
datetime ldt
time lt
decimal ldc

ls_type = Lower(dw_1.Describe(as_col + ".ColType"))
Choose Case True
	Case Left(ls_type, 4) = "char"
		Return dw_1.SetItem(al_row, as_col, as_val)
	Case ls_type = "date"
		If IsDate(as_val) Then ld = Date(as_val) Else SetNull(ld)
		Return dw_1.SetItem(al_row, as_col, ld)
	Case Left(ls_type, 8) = "datetime" Or ls_type = "timestamp"
		If IsDate(Left(as_val, 10)) Then
			ldt = DateTime(Date(Left(as_val, 10)), Time(Trim(Mid(as_val, 11))))
		Else
			SetNull(ldt)
		End If
		Return dw_1.SetItem(al_row, as_col, ldt)
	Case ls_type = "time"
		If IsTime(as_val) Then lt = Time(as_val) Else SetNull(lt)
		Return dw_1.SetItem(al_row, as_col, lt)
	Case Else
		If IsNumber(as_val) Then ldc = Dec(as_val) Else SetNull(ldc)
		Return dw_1.SetItem(al_row, as_col, ldc)
End Choose
Return -1
end function

public function integer wf_dw_to_doc ();// 값 대입: DW 1행의 모든 컬럼 → 문서 (컬럼명 = 개체 이름, 대문자로 맞춘다)
long ll_cols, i
string ls_col, ls_json, ls_result

If Not wf_check() Then Return -1
dw_1.AcceptText()
If dw_1.RowCount() < 1 Then
	MessageBox("값 대입", "DW 에 행이 없습니다")
	Return -1
End If

ll_cols = Long(dw_1.Describe("DataWindow.Column.Count"))
ls_json = "{"
For i = 1 To ll_cols
	ls_col = dw_1.Describe("#" + String(i) + ".Name")
	If i > 1 Then ls_json += ","
	ls_json += wf_json(Upper(ls_col)) + ":" + wf_json(wf_getitem(1, ls_col))
Next
ls_json += "}"

// 한 번에 넣는다. 결과: {"ok":true,"applied":[...],"unknown":[문서에 없는 컬럼],"rejected":[목록에 없는 값]}
ls_result = String(iole.object.SetFields(ls_json, is_sep))
st_status.Text = "값 대입: " + ls_result
Return 1
end function

public function integer wf_doc_to_dw ();// 값 추출: 문서의 모든 값 → DW 1행 (DW 에 있는 컬럼만)
string ls_tsv, ls_line, ls_col, ls_val
long ll_pos, ll_tab, ll_set

If Not wf_check() Then Return -1
// "컬럼<TAB>값" 줄 목록. 값 안의 줄바꿈·탭은 \n, \t 두 글자로 온다
ls_tsv = String(iole.object.GetFieldsTsv(is_sep))
If ls_tsv = "" Then
	st_status.Text = "가져올 값이 없습니다 " + String(iole.object.LastError)
	Return 0
End If
If dw_1.RowCount() < 1 Then dw_1.InsertRow(0)

Do While Len(ls_tsv) > 0
	ll_pos = Pos(ls_tsv, "~r~n")
	If ll_pos = 0 Then ll_pos = Len(ls_tsv) + 1
	ls_line = Left(ls_tsv, ll_pos - 1)
	ls_tsv = Mid(ls_tsv, ll_pos + 2)
	ll_tab = Pos(ls_line, "~t")
	If ll_tab > 0 Then
		ls_col = Lower(Left(ls_line, ll_tab - 1))
		ls_val = Mid(ls_line, ll_tab + 1)
		ls_val = wf_replace_all(ls_val, "\n", "~r~n")
		ls_val = wf_replace_all(ls_val, "\t", "~t")
		If dw_1.Describe(ls_col + ".ColType") <> "!" Then
			If wf_setitem(1, ls_col, ls_val) = 1 Then ll_set++
		End If
	End If
Loop

st_status.Text = "값 추출: DW 에 " + String(ll_set) + "개 넣음 (테이블 " + String(iole.object.GetTable()) + ")"
// 실제 업무에서는 여기서 dw_1.Update() 로 DB 에 저장한다
Return ll_set
end function

public function integer wf_make_dw ();// 연 양식의 개체 이름으로 DW(자유형, 외부 데이터)를 만든다. 실제 업무에서는 DB 테이블 DW 를 쓰면 된다
string ls_tsv, ls_line, ls_col, ls_table, ls_objs, ls_syn, ls_err
long ll_pos, ll_tab, ll_n, ll_y

If Not wf_check() Then Return -1
ls_tsv = String(iole.object.GetFieldsTsv(is_sep))
Do While Len(ls_tsv) > 0
	ll_pos = Pos(ls_tsv, "~r~n")
	If ll_pos = 0 Then ll_pos = Len(ls_tsv) + 1
	ls_line = Left(ls_tsv, ll_pos - 1)
	ls_tsv = Mid(ls_tsv, ll_pos + 2)
	ll_tab = Pos(ls_line, "~t")
	If ll_tab > 0 Then
		ls_col = Lower(Left(ls_line, ll_tab - 1))
		ll_n++
		ll_y = 16 + (ll_n - 1) * 88
		ls_table += 'column=(type=char(4000) updatewhereclause=yes name=' + ls_col + ' dbname="' + ls_col + '") '
		ls_objs += 'text(band=detail alignment="1" text="' + ls_col + '" border="0" color="33554432" x="18" y="' + String(ll_y) + &
			'" height="64" width="440" name=' + ls_col + '_t font.face="맑은 고딕" font.height="-9" font.weight="400" font.family="2" font.pitch="2" font.charset="129" background.mode="1" background.color="536870912")~r~n'
		ls_objs += 'column(band=detail id=' + String(ll_n) + ' alignment="0" tabsequence=' + String(ll_n * 10) + ' border="5" color="33554432" x="476" y="' + String(ll_y) + &
			'" height="64" width="820" format="[general]" name=' + ls_col + ' edit.limit=0 edit.case=any edit.autoselect=yes edit.autohscroll=yes font.face="맑은 고딕" font.height="-9" font.weight="400" font.family="2" font.pitch="2" font.charset="129" background.mode="0" background.color="16777215")~r~n'
	End If
Loop
If ll_n = 0 Then
	MessageBox("DW 만들기", "문서에 개체(누름틀·체크박스 등)가 없습니다")
	Return 0
End If

ls_syn = 'release 12;~r~n' + &
	'datawindow(units=0 timer_interval=0 color=67108864 processing=0 print.margin.left=110 print.margin.right=110 print.margin.top=96 print.margin.bottom=96 print.paper.source=0 print.paper.size=0 print.prompt=no)~r~n' + &
	'header(height=0 color="536870912")~r~nsummary(height=0 color="536870912")~r~nfooter(height=0 color="536870912")~r~n' + &
	'detail(height=' + String(ll_n * 88 + 32) + ' color="536870912")~r~n' + &
	'table(' + ls_table + ')~r~n' + ls_objs
If dw_1.Create(ls_syn, ls_err) <> 1 Then
	MessageBox("DW 만들기 실패", ls_err)
	Return -1
End If
dw_1.InsertRow(0)
st_status.Text = "DW 만듦: 컬럼 " + String(ll_n) + "개"
Return ll_n
end function

public subroutine wf_layout ();long ll_w, ll_h

ll_w = This.WorkSpaceWidth()
ll_h = This.WorkSpaceHeight()
st_status.Width = ll_w - st_status.X - 18
dw_1.Move(ll_w - 1418, 272)
dw_1.Resize(1400, ll_h - 290)
If IsValid(iole) Then
	iole.Move(18, 272)
	iole.Resize(ll_w - 1454, ll_h - 290)
End If
end subroutine

public subroutine wf_load_printers ();// 설치된 프린터를 목록에 넣고 기본 프린터를 고른다
string ls_all, ls_def, ls_name
long ll_pos

ddlb_printer.Reset()
ls_all = String(iole.object.GetPrinters())   // 줄바꿈으로 구분
ls_def = String(iole.object.GetDefaultPrinter())
Do While ls_all <> ""
	ll_pos = Pos(ls_all, "~n")
	If ll_pos = 0 Then
		ls_name = ls_all
		ls_all = ""
	Else
		ls_name = Left(ls_all, ll_pos - 1)
		ls_all = Mid(ls_all, ll_pos + 1)
	End If
	If ls_name <> "" Then ddlb_printer.AddItem(ls_name)
Loop
If ls_def <> "" Then ddlb_printer.SelectItem(ls_def, 0)
end subroutine

on w_hwpx_demo.create
this.sle_file=create sle_file
this.cb_browse=create cb_browse
this.cb_open=create cb_open
this.cbx_edit=create cbx_edit
this.ddlb_mode=create ddlb_mode
this.cb_fill=create cb_fill
this.cb_extract=create cb_extract
this.cb_makedw=create cb_makedw
this.cb_save=create cb_save
this.cb_print=create cb_print
this.st_status=create st_status
this.cb_close=create cb_close
this.ddlb_printer=create ddlb_printer
this.cb_selprinter=create cb_selprinter
this.dw_1=create dw_1
this.Control[]={this.sle_file,&
this.cb_browse,&
this.cb_open,&
this.cbx_edit,&
this.ddlb_mode,&
this.cb_fill,&
this.cb_extract,&
this.cb_makedw,&
this.cb_save,&
this.cb_print,&
this.st_status,&
this.cb_close,&
this.ddlb_printer,&
this.cb_selprinter,&
this.dw_1}
end on

on w_hwpx_demo.destroy
destroy(this.sle_file)
destroy(this.cb_browse)
destroy(this.cb_open)
destroy(this.cbx_edit)
destroy(this.ddlb_mode)
destroy(this.cb_fill)
destroy(this.cb_extract)
destroy(this.cb_makedw)
destroy(this.cb_save)
destroy(this.cb_print)
destroy(this.st_status)
destroy(this.cb_close)
destroy(this.ddlb_printer)
destroy(this.cb_selprinter)
destroy(this.dw_1)
end on

event open;// 창에 놓은 OLE 컨트롤을 찾는다 (이름에 상관없이)
integer i

For i = 1 To UpperBound(Control[])
	If Control[i].TypeOf() = OLECustomControl! Then
		iole = Control[i]
		Exit
	End If
Next

// 열 파일: OpenWithParm(w_hwpx_demo, "C:\forms\처방전.hwpx") 또는 실행 인수 (예: myapp.exe C:\forms\처방전.hwpx)
is_file = Trim(Message.StringParm)
If is_file = "" Then is_file = Trim(CommandParm())
If Left(is_file, 1) = '"' Then is_file = Mid(is_file, 2, Len(is_file) - 2)
sle_file.Text = is_file

ddlb_mode.SelectItem(1)
ddlb_mode.Enabled = cbx_edit.Checked
wf_layout()

If Not IsValid(iole) Then
	st_status.Text = "창에 OLE 컨트롤(HwpxEditorControl)을 놓아 주세요"
	Return
End If
st_status.Text = "에디터 준비 중..."
Timer(0.3)  // 준비되면 ue_ready
end event

event timer;// OCX 가 준비됐는지 본다 (ready 이벤트 대신. 컨트롤에 스크립트를 넣지 않아도 되게)
boolean lb_ready
string ls_status

If Not IsValid(iole) Then
	Timer(0)
	Return
End If
Try
	lb_ready = iole.object.IsReady
	ls_status = String(iole.object.Status)   // 어디까지 진행됐는지 (C++ 판 0.2.2 이상)
Catch (RuntimeError re)
	lb_ready = False
	ls_status = re.GetMessage()
End Try
If lb_ready Then
	Timer(0)
	Post Event ue_ready()
	Return
End If
il_wait++
st_status.Text = "에디터 준비 중... " + ls_status
If il_wait = 200 Then  // 약 60초
	Timer(0)
	MessageBox("에디터가 준비되지 않았습니다", ls_status + "~r~n~r~n" + String(iole.object.LastError))
End If
end event

event resize;wf_layout()
end event

type sle_file from singlelineedit within w_hwpx_demo
integer x = 18
integer y = 32
integer width = 1650
integer height = 92
integer taborder = 10
integer textsize = -10
integer weight = 400
fontcharset fontcharset = hangeul!
fontpitch fontpitch = variable!
fontfamily fontfamily = swiss!
string facename = "맑은 고딕"
long textcolor = 33554432
borderstyle borderstyle = stylelowered!
end type

type cb_browse from commandbutton within w_hwpx_demo
integer x = 1682
integer y = 28
integer width = 160
integer height = 100
integer taborder = 20
integer textsize = -10
integer weight = 400
fontcharset fontcharset = hangeul!
fontpitch fontpitch = variable!
fontfamily fontfamily = swiss!
string facename = "맑은 고딕"
string text = "..."
end type

event clicked;string ls_path, ls_name

If GetFileOpenName("HWPX 파일 선택", ls_path, ls_name, "hwpx", "한글 문서 (*.hwpx),*.hwpx") = 1 Then
	sle_file.Text = ls_path
End If
end event

type cb_open from commandbutton within w_hwpx_demo
integer x = 1856
integer y = 28
integer width = 300
integer height = 100
integer taborder = 30
integer textsize = -10
integer weight = 400
fontcharset fontcharset = hangeul!
fontpitch fontpitch = variable!
fontfamily fontfamily = swiss!
string facename = "맑은 고딕"
string text = "열기"
end type

event clicked;wf_open(Trim(sle_file.Text))
end event

type cbx_edit from checkbox within w_hwpx_demo
integer x = 2190
integer y = 40
integer width = 380
integer height = 80
integer textsize = -10
integer weight = 400
fontcharset fontcharset = hangeul!
fontpitch fontpitch = variable!
fontfamily fontfamily = swiss!
string facename = "맑은 고딕"
long textcolor = 33554432
long backcolor = 67108864
string text = "편집 권한"
end type

event clicked;// 실제 업무에서는 사용자 권한(예: gs_user_role = "ADMIN")으로 정한다
ddlb_mode.Enabled = This.Checked
If Not This.Checked Then ddlb_mode.SelectItem(1)
If IsValid(iole) And ib_ready Then iole.object.AllowEdit = This.Checked
end event

type ddlb_mode from dropdownlistbox within w_hwpx_demo
integer x = 2580
integer y = 32
integer width = 330
integer height = 300
integer taborder = 40
integer textsize = -10
integer weight = 400
fontcharset fontcharset = hangeul!
fontpitch fontpitch = variable!
fontfamily fontfamily = swiss!
string facename = "맑은 고딕"
long textcolor = 33554432
boolean sorted = false
string item[] = {"작성","편집"}
borderstyle borderstyle = stylelowered!
end type

event selectionchanged;string ls_mode = "form"

If Not ib_ready Then Return
If This.Text = "편집" Then ls_mode = "edit"
If Not iole.object.SetMode(ls_mode) Then
	MessageBox("모드", String(iole.object.LastError))
	This.SelectItem(1)
End If
end event

type cb_fill from commandbutton within w_hwpx_demo
integer x = 18
integer y = 152
integer width = 600
integer height = 100
integer taborder = 50
integer textsize = -10
integer weight = 400
fontcharset fontcharset = hangeul!
fontpitch fontpitch = variable!
fontfamily fontfamily = swiss!
string facename = "맑은 고딕"
string text = "DW → 문서 (값 대입)"
end type

event clicked;wf_dw_to_doc()
end event

type cb_extract from commandbutton within w_hwpx_demo
integer x = 632
integer y = 152
integer width = 600
integer height = 100
integer taborder = 60
integer textsize = -10
integer weight = 400
fontcharset fontcharset = hangeul!
fontpitch fontpitch = variable!
fontfamily fontfamily = swiss!
string facename = "맑은 고딕"
string text = "문서 → DW (값 추출)"
end type

event clicked;wf_doc_to_dw()
end event

type cb_makedw from commandbutton within w_hwpx_demo
integer x = 1246
integer y = 152
integer width = 400
integer height = 100
integer taborder = 70
integer textsize = -10
integer weight = 400
fontcharset fontcharset = hangeul!
fontpitch fontpitch = variable!
fontfamily fontfamily = swiss!
string facename = "맑은 고딕"
string text = "DW 만들기"
end type

event clicked;wf_make_dw()
end event

type cb_save from commandbutton within w_hwpx_demo
integer x = 1660
integer y = 152
integer width = 300
integer height = 100
integer taborder = 80
integer textsize = -10
integer weight = 400
fontcharset fontcharset = hangeul!
fontpitch fontpitch = variable!
fontfamily fontfamily = swiss!
string facename = "맑은 고딕"
string text = "저장"
end type

event clicked;string ls_path, ls_name

If Not wf_check() Then Return
If GetFileSaveName("다른 이름으로 저장", ls_path, ls_name, "hwpx", "한글 문서 (*.hwpx),*.hwpx") <> 1 Then Return
If iole.object.SaveAs(ls_path, is_sep) Then
	st_status.Text = "저장: " + ls_path
Else
	MessageBox("저장 실패", String(iole.object.LastError))
End If
end event

type cb_print from commandbutton within w_hwpx_demo
integer x = 1974
integer y = 152
integer width = 300
integer height = 100
integer taborder = 90
integer textsize = -10
integer weight = 400
fontcharset fontcharset = hangeul!
fontpitch fontpitch = variable!
fontfamily fontfamily = swiss!
string facename = "맑은 고딕"
string text = "인쇄"
end type

event clicked;// 고른 프린터로 바로 인쇄. 프린터를 고르지 않았으면 인쇄 대화상자(미리보기)
string ls_printer

If Not wf_check() Then Return
ls_printer = Trim(ddlb_printer.Text)
If ls_printer = "" Then
	If Not iole.object.Print() Then MessageBox("인쇄", String(iole.object.LastError))
	Return
End If
If iole.object.PrintTo(ls_printer, 1) Then
	st_status.Text = "인쇄: " + ls_printer
Else
	MessageBox("인쇄", String(iole.object.LastError))
End If
end event

type st_status from statictext within w_hwpx_demo
integer x = 3220
integer y = 44
integer width = 1100
integer height = 72
integer textsize = -10
integer weight = 400
fontcharset fontcharset = hangeul!
fontpitch fontpitch = variable!
fontfamily fontfamily = swiss!
string facename = "맑은 고딕"
long textcolor = 33554432
long backcolor = 67108864
boolean focusrectangle = false
end type

type cb_close from commandbutton within w_hwpx_demo
integer x = 2930
integer y = 28
integer width = 260
integer height = 100
integer taborder = 45
integer textsize = -10
integer weight = 400
fontcharset fontcharset = hangeul!
fontpitch fontpitch = variable!
fontfamily fontfamily = swiss!
string facename = "맑은 고딕"
string text = "닫기"
end type

event clicked;If Not wf_check() Then Return
If iole.object.CloseDocument() Then
	sle_file.Text = ""
	st_status.Text = "문서를 닫았습니다"
Else
	MessageBox("닫기", String(iole.object.LastError))
End If
end event

type ddlb_printer from dropdownlistbox within w_hwpx_demo
integer x = 2288
integer y = 156
integer width = 1000
integer height = 600
integer taborder = 92
integer textsize = -10
integer weight = 400
fontcharset fontcharset = hangeul!
fontpitch fontpitch = variable!
fontfamily fontfamily = swiss!
string facename = "맑은 고딕"
long textcolor = 33554432
boolean sorted = false
boolean vscrollbar = true
borderstyle borderstyle = stylelowered!
end type

type cb_selprinter from commandbutton within w_hwpx_demo
integer x = 3302
integer y = 152
integer width = 360
integer height = 100
integer taborder = 94
integer textsize = -10
integer weight = 400
fontcharset fontcharset = hangeul!
fontpitch fontpitch = variable!
fontfamily fontfamily = swiss!
string facename = "맑은 고딕"
string text = "프린터 선택..."
end type

event clicked;// Windows 프린터 선택 창. 고른 프린터를 목록에서 선택해 둔다 (인쇄 버튼이 그 프린터로 찍음)
string ls_name

If Not wf_check() Then Return
ls_name = String(iole.object.SelectPrinter())
If ls_name = "" Then Return   // 취소
If ddlb_printer.FindItem(ls_name, 0) <= 0 Then ddlb_printer.AddItem(ls_name)
ddlb_printer.SelectItem(ls_name, 0)
st_status.Text = "프린터: " + ls_name
end event

type dw_1 from datawindow within w_hwpx_demo
integer x = 2900
integer y = 272
integer width = 1400
integer height = 2200
integer taborder = 100
string title = "none"
boolean vscrollbar = true
boolean livescroll = true
borderstyle borderstyle = stylelowered!
end type
