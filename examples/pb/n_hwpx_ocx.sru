$PBExportHeader$n_hwpx_ocx.sru
$PBExportComments$Windows 7 / Windows 10 에 맞는 HwpxEditor OCX 를 골라 등록 확인 (창을 열기 전에 부른다)
forward
global type n_hwpx_ocx from nonvisualobject
end type
end forward

global type n_hwpx_ocx from nonvisualobject autoinstantiate
end type

type prototypes
subroutine Sleep (ulong dwMilliseconds) library "kernel32.dll"
end prototypes

type variables
// 설치 폴더. 아래에 두 판을 풀어 둔다
//   <is_root>\win7\   HwpxEditor-native-win7.zip (WebView2 109 고정 버전 포함)
//   <is_root>\win10\  HwpxEditor-native.zip      (PC 에 설치된 최신 WebView2 사용)
public string is_root = "C:\hwpxpb"
public long il_wait_seconds = 60   // register.bat (UAC 확인) 을 기다리는 시간
public string is_error
// 두 판 모두 같은 CLSID·ProgID(Hwpxpb.Editor). 한 PC 에는 하나만 등록된다
constant string CLSID_KEY = "HKEY_CLASSES_ROOT\CLSID\{6B2E7C1A-3F4D-4E8B-9A51-2C7D0E9F1A03}\InprocServer32"
end variables

forward prototypes
public function boolean of_is_win7 ()
public function string of_os_name ()
public function string of_ocx_dir ()
public function string of_ocx_path ()
public function string of_registered_path ()
public function boolean of_is_registered ()
public function integer of_ensure_registered ()
end prototypes

public function boolean of_is_win7 ();// Windows 10/11 에만 CurrentMajorVersionNumber 가 있다. 없으면 Windows 7 / 8.1 (WebView2 109 가 마지막)
// GetEnvironment() 의 OSMajorRevision 은 PB 12.1 에서 Windows 10 도 6.2 로 보이므로 쓰지 않는다
ulong lul_major
If RegistryGet("HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows NT\CurrentVersion", "CurrentMajorVersionNumber", RegULong!, lul_major) = 1 Then
	Return lul_major < 10
End If
Return True
end function

public function string of_os_name ();If of_is_win7() Then Return "win7"
Return "win10"
end function

public function string of_ocx_dir ();Return is_root + "\" + of_os_name()
end function

public function string of_ocx_path ();Return of_ocx_dir() + "\HwpxEditor.ocx"
end function

public function string of_registered_path ();// 32비트 PB 는 32비트 레지스트리(WOW6432Node)를 읽으므로 32비트 regsvr32 로 등록한 경로가 나온다
string ls_path
If RegistryGet(CLSID_KEY, "", RegString!, ls_path) <> 1 Then Return ""
Return ls_path
end function

public function boolean of_is_registered ();Return Lower(Trim(of_registered_path())) = Lower(of_ocx_path())
end function

public function integer of_ensure_registered ();// 이 PC 의 Windows 에 맞는 OCX 가 등록되어 있는지 확인하고, 아니면 그 폴더의 register.bat 을 실행한다.
//  1 = 맞는 OCX 가 등록되어 있음 (창을 열어도 됨)
// -1 = 해당 폴더/파일 없음, -2 = 등록 실패 또는 시간 초과 (is_error 에 이유)
string ls_bat
long ll_start

is_error = ""
If of_is_registered() Then Return 1

If Not FileExists(of_ocx_path()) Then
	is_error = "OCX 파일이 없습니다: " + of_ocx_path() + "~r~n" + &
		of_os_name() + " 용 zip 을 " + of_ocx_dir() + " 에 풀어 주세요."
	Return -1
End If

ls_bat = of_ocx_dir() + "\register.bat"
If Not FileExists(ls_bat) Then
	is_error = "register.bat 이 없습니다: " + ls_bat
	Return -1
End If

// register.bat 이 관리자 권한을 스스로 요청한다 (사용자가 UAC 에서 '예'를 눌러야 함)
If Run('cmd.exe /c ""' + ls_bat + '""', Normal!) <> 1 Then
	is_error = "register.bat 을 실행할 수 없습니다: " + ls_bat
	Return -2
End If

ll_start = Cpu()
Do While Cpu() - ll_start < il_wait_seconds * 1000
	Sleep(500)
	Yield()
	If of_is_registered() Then Return 1
Loop

is_error = "OCX 등록을 확인하지 못했습니다. " + ls_bat + " 을 마우스 오른쪽 > 관리자 권한으로 실행해 주세요.~r~n" + &
	"지금 등록된 경로: " + of_registered_path()
Return -2
end function

on n_hwpx_ocx.create
call super::create
TriggerEvent( this, "constructor" )
end on

on n_hwpx_ocx.destroy
TriggerEvent( this, "destructor" )
call super::destroy
end on
