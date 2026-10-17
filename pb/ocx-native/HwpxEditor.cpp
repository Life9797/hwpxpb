// PowerBuilder 12.1 에서 OLE 컨트롤로 쓰는 HWPX 에디터 (C++/ATL + WebView2). .NET 이 필요 없다.
//
// pb/ocx (.NET 판) 과 CLSID·ProgID("Hwpxpb.Editor")·메서드·이벤트가 같아서 PB 쪽 코드는 그대로 쓴다.
// - 화면: 설치 폴더의 web\ (pb/dist) 를 https://hwpxpb.local/ 로 연다. 네트워크가 필요 없다.
// - PB → 에디터: 아래 메서드. 모두 동기식(메시지를 돌리며 기다림). 결과는 JSON 문자열 또는 bool.
// - 에디터 → PB: Ready / Loaded / ErrorOccurred 이벤트.
// - 지원: Windows 7 SP1 이상 (WebView2 런타임 필요. Windows 7 은 109 가 마지막)
//
// 등록: regsvr32 HwpxEditor.ocx (관리자 권한, 32비트 regsvr32)
#define _ATL_APARTMENT_THREADED
#define _ATL_NO_AUTOMATIC_NAMESPACE
#define _ATL_CSTRING_EXPLICIT_CONSTRUCTORS

#include <sdkddkver.h>
#include <atlbase.h>
#include <atlcom.h>
#include <atlctl.h>
#include <wrl.h>
#include <shlobj.h>
#include <wincrypt.h>
#include <winspool.h>
#include <WebView2.h>

#include <cstdlib>
#include <cwctype>
#include <map>
#include <string>
#include <vector>

// winspool.h 의 GetDefaultPrinter 매크로가 같은 이름의 메서드를 바꾸지 않게
#undef GetDefaultPrinter

#include "resource.h"
#include "HwpxEditor_i.h"

using namespace ATL;
using Microsoft::WRL::Callback;

namespace {

const wchar_t* const kHost = L"hwpxpb.local";
const UINT WM_HWPX_EVENTS = WM_APP + 0x48;

std::wstring Str(BSTR b) { return b ? std::wstring(b, SysStringLen(b)) : std::wstring(); }
BSTR Bstr(const std::wstring& s) { return SysAllocStringLen(s.data(), static_cast<UINT>(s.size())); }
VARIANT_BOOL Vb(bool b) { return b ? VARIANT_TRUE : VARIANT_FALSE; }

std::wstring Lower(std::wstring s) {
	for (auto& c : s) c = static_cast<wchar_t>(towlower(c));
	return s;
}

/** JS/JSON 문자열 리터럴 ("...") */
std::wstring Js(const std::wstring& s) {
	std::wstring out = L"\"";
	for (wchar_t c : s) {
		switch (c) {
		case L'"': out += L"\\\""; break;
		case L'\\': out += L"\\\\"; break;
		case L'\n': out += L"\\n"; break;
		case L'\r': out += L"\\r"; break;
		case L'\t': out += L"\\t"; break;
		default:
			if (c < 0x20 || c == 0x2028 || c == 0x2029) {
				wchar_t buf[8];
				swprintf_s(buf, L"\\u%04x", static_cast<unsigned>(c));
				out += buf;
			} else {
				out += c;
			}
		}
	}
	return out + L"\"";
}

/** {"key":"value",...} 에서 문자열 값 하나 (bridge 가 보내는 평평한 JSON 용) */
std::wstring JsonString(const std::wstring& json, const wchar_t* key) {
	std::wstring pat = std::wstring(L"\"") + key + L"\":";
	size_t i = json.find(pat);
	if (i == std::wstring::npos) return L"";
	i += pat.size();
	while (i < json.size() && iswspace(json[i])) i++;
	if (i >= json.size() || json[i] != L'"') return L"";
	std::wstring out;
	for (i++; i < json.size(); i++) {
		wchar_t c = json[i];
		if (c == L'"') break;
		if (c != L'\\' || i + 1 >= json.size()) { out += c; continue; }
		wchar_t e = json[++i];
		switch (e) {
		case L'n': out += L'\n'; break;
		case L'r': out += L'\r'; break;
		case L't': out += L'\t'; break;
		case L'b': out += L'\b'; break;
		case L'f': out += L'\f'; break;
		case L'u':
			if (i + 4 < json.size()) {
				out += static_cast<wchar_t>(wcstoul(json.substr(i + 1, 4).c_str(), nullptr, 16));
				i += 4;
			}
			break;
		default: out += e;
		}
	}
	return out;
}

/** encodeURIComponent 의 반대 (UTF-8) */
std::wstring UrlDecode(const std::wstring& s) {
	std::string bytes;
	for (size_t i = 0; i < s.size(); i++) {
		if (s[i] == L'%' && i + 2 < s.size()) {
			bytes += static_cast<char>(wcstoul(s.substr(i + 1, 2).c_str(), nullptr, 16));
			i += 2;
		} else {
			bytes += static_cast<char>(s[i]);
		}
	}
	if (bytes.empty()) return L"";
	int n = MultiByteToWideChar(CP_UTF8, 0, bytes.data(), static_cast<int>(bytes.size()), nullptr, 0);
	std::wstring out(n, L'\0');
	MultiByteToWideChar(CP_UTF8, 0, bytes.data(), static_cast<int>(bytes.size()), &out[0], n);
	return out;
}

std::wstring HrText(HRESULT hr) {
	wchar_t buf[32];
	swprintf_s(buf, L" (0x%08X)", static_cast<unsigned>(hr));
	return buf;
}

std::wstring ModuleDir() {
	wchar_t path[MAX_PATH * 2] = {};
	GetModuleFileNameW(_AtlBaseModule.GetModuleInstance(), path, ARRAYSIZE(path));
	std::wstring p = path;
	size_t slash = p.find_last_of(L"\\/");
	return slash == std::wstring::npos ? p : p.substr(0, slash);
}

std::wstring LocalAppData() {
	wchar_t path[MAX_PATH] = {};
	if (FAILED(SHGetFolderPathW(nullptr, CSIDL_LOCAL_APPDATA, nullptr, SHGFP_TYPE_CURRENT, path))) return ModuleDir();
	return path;
}

bool FileExists(const std::wstring& p) {
	DWORD a = GetFileAttributesW(p.c_str());
	return a != INVALID_FILE_ATTRIBUTES && !(a & FILE_ATTRIBUTE_DIRECTORY);
}

std::wstring FileName(const std::wstring& path) {
	size_t slash = path.find_last_of(L"\\/");
	return slash == std::wstring::npos ? path : path.substr(slash + 1);
}

bool ReadAll(const std::wstring& path, std::vector<BYTE>& data, std::wstring& err) {
	HANDLE h = CreateFileW(path.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING, 0, nullptr);
	if (h == INVALID_HANDLE_VALUE) { err = L"파일을 열 수 없습니다: " + path; return false; }
	LARGE_INTEGER size = {};
	GetFileSizeEx(h, &size);
	data.resize(static_cast<size_t>(size.QuadPart));
	DWORD read = 0;
	BOOL ok = data.empty() || ReadFile(h, data.data(), static_cast<DWORD>(data.size()), &read, nullptr);
	CloseHandle(h);
	if (!ok || read != data.size()) { err = L"파일을 읽을 수 없습니다: " + path; return false; }
	return true;
}

bool WriteAll(const std::wstring& path, const std::vector<BYTE>& data, std::wstring& err) {
	HANDLE h = CreateFileW(path.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
	if (h == INVALID_HANDLE_VALUE) { err = L"파일을 쓸 수 없습니다: " + path; return false; }
	DWORD written = 0;
	BOOL ok = data.empty() || WriteFile(h, data.data(), static_cast<DWORD>(data.size()), &written, nullptr);
	CloseHandle(h);
	if (!ok || written != data.size()) { err = L"파일을 쓸 수 없습니다: " + path; return false; }
	return true;
}

std::wstring ToBase64(const std::vector<BYTE>& data) {
	if (data.empty()) return L"";
	DWORD n = 0;
	const DWORD flags = CRYPT_STRING_BASE64 | CRYPT_STRING_NOCRLF;
	CryptBinaryToStringW(data.data(), static_cast<DWORD>(data.size()), flags, nullptr, &n);
	std::wstring out(n, L'\0');
	CryptBinaryToStringW(data.data(), static_cast<DWORD>(data.size()), flags, &out[0], &n);
	out.resize(n);
	return out;
}

bool FromBase64(const std::wstring& b64, std::vector<BYTE>& data) {
	DWORD n = 0;
	if (!CryptStringToBinaryW(b64.c_str(), static_cast<DWORD>(b64.size()), CRYPT_STRING_BASE64, nullptr, &n, nullptr, nullptr)) return false;
	data.resize(n);
	return CryptStringToBinaryW(b64.c_str(), static_cast<DWORD>(b64.size()), CRYPT_STRING_BASE64, data.data(), &n, nullptr, nullptr) != FALSE;
}

std::wstring Mode(BSTR m) {
	std::wstring s = Lower(Str(m));
	return s.empty() ? L"form" : s;
}

std::wstring Sep(BSTR s) {
	std::wstring v = Str(s);
	return v.empty() ? L":" : v;
}

}  // namespace

// ---- 이벤트 (PB 의 ready / loaded / erroroccurred) -------------------------------

template <class T>
class CProxyHwpxEditorEvents : public IConnectionPointImpl<T, &DIID_IHwpxEditorEvents> {
public:
	// args 는 DISPPARAMS 규칙대로 뒤에서부터
	void FireDispEvent(DISPID id, VARIANT* args, UINT count) {
		std::vector<CComPtr<IUnknown>> sinks;
		for (int i = 0; i < this->m_vec.GetSize(); i++) {
			IUnknown* p = this->m_vec.GetAt(i);
			if (p) sinks.push_back(p);
		}
		for (auto& sink : sinks) {
			CComQIPtr<IDispatch> disp(sink);
			if (!disp) continue;
			DISPPARAMS dp = {args, nullptr, count, 0};
			disp->Invoke(id, IID_NULL, LOCALE_USER_DEFAULT, DISPATCH_METHOD, &dp, nullptr, nullptr, nullptr);
		}
	}
};

// ---- 컨트롤 -----------------------------------------------------------------------

class ATL_NO_VTABLE CHwpxEditor :
	public CComObjectRootEx<CComSingleThreadModel>,
	public IDispatchImpl<IHwpxEditor, &IID_IHwpxEditor, &LIBID_HwpxpbLib, 1, 0>,
	public IPersistStreamInitImpl<CHwpxEditor>,
	public IOleControlImpl<CHwpxEditor>,
	public IOleObjectImpl<CHwpxEditor>,
	public IOleInPlaceActiveObjectImpl<CHwpxEditor>,
	public IViewObjectExImpl<CHwpxEditor>,
	public IOleInPlaceObjectWindowlessImpl<CHwpxEditor>,
	public IConnectionPointContainerImpl<CHwpxEditor>,
	public CProxyHwpxEditorEvents<CHwpxEditor>,
	public IPersistStorageImpl<CHwpxEditor>,
	public IQuickActivateImpl<CHwpxEditor>,
	public IProvideClassInfo2Impl<&CLSID_HwpxEditorControl, &DIID_IHwpxEditorEvents, &LIBID_HwpxpbLib>,
	public CComCoClass<CHwpxEditor, &CLSID_HwpxEditorControl>,
	public CComControl<CHwpxEditor>
{
public:
	CHwpxEditor() { m_bWindowOnly = TRUE; }

	DECLARE_OLEMISC_STATUS(OLEMISC_RECOMPOSEONRESIZE | OLEMISC_CANTLINKINSIDE | OLEMISC_INSIDEOUT |
		OLEMISC_ACTIVATEWHENVISIBLE | OLEMISC_SETCLIENTSITEFIRST)
	DECLARE_REGISTRY_RESOURCEID(IDR_HWPXEDITOR)
	DECLARE_NOT_AGGREGATABLE(CHwpxEditor)

	BEGIN_COM_MAP(CHwpxEditor)
		COM_INTERFACE_ENTRY(IHwpxEditor)
		COM_INTERFACE_ENTRY(IDispatch)
		COM_INTERFACE_ENTRY(IViewObjectEx)
		COM_INTERFACE_ENTRY(IViewObject2)
		COM_INTERFACE_ENTRY(IViewObject)
		COM_INTERFACE_ENTRY(IOleInPlaceObjectWindowless)
		COM_INTERFACE_ENTRY(IOleInPlaceObject)
		COM_INTERFACE_ENTRY2(IOleWindow, IOleInPlaceObjectWindowless)
		COM_INTERFACE_ENTRY(IOleInPlaceActiveObject)
		COM_INTERFACE_ENTRY(IOleControl)
		COM_INTERFACE_ENTRY(IOleObject)
		COM_INTERFACE_ENTRY(IPersistStreamInit)
		COM_INTERFACE_ENTRY2(IPersist, IPersistStreamInit)
		COM_INTERFACE_ENTRY(IConnectionPointContainer)
		COM_INTERFACE_ENTRY(IQuickActivate)
		COM_INTERFACE_ENTRY(IPersistStorage)
		COM_INTERFACE_ENTRY(IProvideClassInfo)
		COM_INTERFACE_ENTRY(IProvideClassInfo2)
	END_COM_MAP()

	BEGIN_PROP_MAP(CHwpxEditor)
		PROP_DATA_ENTRY("_cx", m_sizeExtent.cx, VT_UI4)
		PROP_DATA_ENTRY("_cy", m_sizeExtent.cy, VT_UI4)
	END_PROP_MAP()

	BEGIN_CONNECTION_POINT_MAP(CHwpxEditor)
		CONNECTION_POINT_ENTRY(DIID_IHwpxEditorEvents)
	END_CONNECTION_POINT_MAP()

	BEGIN_MSG_MAP(CHwpxEditor)
		MESSAGE_HANDLER(WM_CREATE, OnCreate)
		MESSAGE_HANDLER(WM_SIZE, OnSize)
		MESSAGE_HANDLER(WM_SETFOCUS, OnFocus)
		MESSAGE_HANDLER(WM_DESTROY, OnDestroy)
		MESSAGE_HANDLER(WM_HWPX_EVENTS, OnHwpxEvents)
		CHAIN_MSG_MAP(CComControl<CHwpxEditor>)
		DEFAULT_REFLECTION_HANDLER()
	END_MSG_MAP()

	DECLARE_VIEW_STATUS(VIEWSTATUS_SOLIDBKGND | VIEWSTATUS_OPAQUE)

	HRESULT OnDraw(ATL_DRAWINFO& di) {
		FillRect(di.hdcDraw, reinterpret_cast<const RECT*>(di.prcBounds), static_cast<HBRUSH>(GetStockObject(WHITE_BRUSH)));
		return S_OK;
	}

	DECLARE_PROTECT_FINAL_CONSTRUCT()
	typedef IDispatchImpl<IHwpxEditor, &IID_IHwpxEditor, &LIBID_HwpxpbLib, 1, 0> DispBase;
	typedef IProvideClassInfo2Impl<&CLSID_HwpxEditorControl, &DIID_IHwpxEditorEvents, &LIBID_HwpxpbLib> ClassInfoBase;

	// 형식 정보(typelib)를 레지스트리 대신 OCX 파일에서 직접 읽는다.
	// 등록/해제를 여러 번 하거나 폴더를 옮겨 레지스트리의 typelib 경로가 어긋나도 속성·메서드 호출이 되게 한다.
	HRESULT FinalConstruct() {
		if (!DispBase::_tih.m_pInfo || !ClassInfoBase::_tih.m_pInfo) {
			wchar_t path[MAX_PATH * 2] = {};
			GetModuleFileNameW(_AtlBaseModule.GetModuleInstance(), path, ARRAYSIZE(path));
			CComPtr<ITypeLib> lib;
			if (SUCCEEDED(LoadTypeLibEx(path, REGKIND_NONE, &lib)) && lib) {
				if (!DispBase::_tih.m_pInfo) lib->GetTypeInfoOfGuid(IID_IHwpxEditor, &DispBase::_tih.m_pInfo);
				if (!ClassInfoBase::_tih.m_pInfo) lib->GetTypeInfoOfGuid(CLSID_HwpxEditorControl, &ClassInfoBase::_tih.m_pInfo);
			}
		}
		return S_OK;
	}
	void FinalRelease() { CloseWebView(); }

	// ---- PB 에서 부르는 메서드 ----------------------------------------------------

	STDMETHOD(Open)(BSTR path, BSTR mode, VARIANT_BOOL* result) {
		std::vector<BYTE> data;
		std::wstring err;
		if (!ReadAll(Str(path), data, err)) return Ret(result, Fail(err));
		CComBSTR b64(ToBase64(data).c_str());
		CComBSTR name(FileName(Str(path)).c_str());
		return OpenBase64(b64, name, mode, result);
	}

	STDMETHOD(OpenBase64)(BSTR base64, BSTR fileName, BSTR mode, VARIANT_BOOL* result) {
		std::wstring name = Str(fileName);
		if (name.empty()) name = L"document.hwpx";
		return Ret(result, Call(L"open", {Js(Str(base64)), Js(name), Js(Mode(mode))}).ok);
	}

	STDMETHOD(SetMode)(BSTR mode, VARIANT_BOOL* result) {
		return Ret(result, Call(L"setMode", {Js(Mode(mode))}).ok);
	}

	STDMETHOD(GetSchema)(BSTR* result) { return Ret(result, Call(L"getSchema", {}).Json()); }

	STDMETHOD(SetFields)(BSTR valuesJson, BSTR comboSep, BSTR* result) {
		std::wstring v = Str(valuesJson);
		return Ret(result, Call(L"setFields", {Js(v.empty() ? L"{}" : v), Js(Sep(comboSep))}).Json());
	}

	STDMETHOD(GetFields)(BSTR comboSep, BSTR* result) { return Ret(result, Call(L"getFields", {Js(Sep(comboSep))}).Json()); }

	STDMETHOD(SaveAs)(BSTR path, BSTR comboSep, VARIANT_BOOL* result) {
		Result r = Call(L"getDocument", {Js(Sep(comboSep))}, L"function(o){return o.hwpx||''}");
		if (!r.ok || r.payload.empty()) return Ret(result, false);
		std::vector<BYTE> data;
		if (!FromBase64(r.payload, data)) return Ret(result, Fail(L"문서 내용을 풀 수 없습니다"));
		std::wstring err;
		return Ret(result, WriteAll(Str(path), data, err) || Fail(err));
	}

	STDMETHOD(GetDocumentBase64)(BSTR comboSep, BSTR* result) {
		Result r = Call(L"getDocument", {Js(Sep(comboSep))}, L"function(o){return o.hwpx||''}");
		return Ret(result, r.ok ? r.payload : L"");
	}

	STDMETHOD(SavePdf)(BSTR path, VARIANT_BOOL* result) {
		if (!Call(L"preparePrint", {}).ok) return Ret(result, false);
		CComQIPtr<ICoreWebView2_7> w7(m_web);
		CComPtr<ICoreWebView2PrintSettings> settings;
		if (!w7 || !NewPrintSettings(settings)) return Ret(result, Fail(L"이 WebView2 런타임은 PDF 저장을 지원하지 않습니다"));
		bool done = false, ok = false;
		std::wstring file = Str(path);
		HRESULT hr = w7->PrintToPdf(file.c_str(), settings,
			Callback<ICoreWebView2PrintToPdfCompletedHandler>([&done, &ok](HRESULT code, BOOL success) -> HRESULT {
				ok = SUCCEEDED(code) && success;
				done = true;
				return S_OK;
			}).Get());
		if (FAILED(hr)) return Ret(result, Fail(L"PDF 저장 실패" + HrText(hr)));
		if (!Wait([&done] { return done; })) return Ret(result, Fail(L"PDF 저장 시간 초과"));
		return Ret(result, ok || Fail(L"PDF 저장 실패: " + file));
	}

	STDMETHOD(get_LastError)(BSTR* value) { return Ret(value, m_lastError); }
	STDMETHOD(get_IsReady)(VARIANT_BOOL* value) { return Ret(value, m_ready); }
	/** 지금 단계 (준비가 안 될 때 어디서 멈췄는지 보는 용도) */
	STDMETHOD(get_Status)(BSTR* value) { return Ret(value, m_status); }
	/** 쓰는 WebView2 런타임 버전 */
	STDMETHOD(get_BrowserVersion)(BSTR* value) { return Ret(value, m_browserVersion); }
	STDMETHOD(get_TimeoutSeconds)(long* value) {
		if (!value) return E_POINTER;
		*value = m_timeout;
		return S_OK;
	}
	STDMETHOD(put_TimeoutSeconds)(long value) {
		m_timeout = value > 0 ? value : 60;
		return S_OK;
	}
	STDMETHOD(get_WebFolder)(BSTR* value) { return Ret(value, m_webFolder); }
	STDMETHOD(put_WebFolder)(BSTR value) {
		m_webFolder = Str(value);
		return S_OK;
	}
	STDMETHOD(get_PdfLandscape)(VARIANT_BOOL* value) { return Ret(value, m_landscape); }
	STDMETHOD(put_PdfLandscape)(VARIANT_BOOL value) {
		m_landscape = value != VARIANT_FALSE;
		return S_OK;
	}
	// 편집 권한자에게 작성 모드에서도 원래 메뉴·도구 모음을 보여 줄지 (권한 없는 사용자에게는 항상 숨김)
	STDMETHOD(get_ShowMenu)(VARIANT_BOOL* value) { return Ret(value, m_showMenu); }
	STDMETHOD(put_ShowMenu)(VARIANT_BOOL value) {
		m_showMenu = value != VARIANT_FALSE;
		if (m_ready) Call(L"setShowMenu", {m_showMenu ? L"true" : L"false"});
		return S_OK;
	}
	STDMETHOD(get_AllowEdit)(VARIANT_BOOL* value) { return Ret(value, m_allowEdit); }
	STDMETHOD(put_AllowEdit)(VARIANT_BOOL value) {
		m_allowEdit = value != VARIANT_FALSE;
		if (m_ready) Call(L"setPermission", {m_allowEdit ? L"true" : L"false"});
		return S_OK;
	}

	STDMETHOD(GetFieldValue)(BSTR column, BSTR comboSep, BSTR* result) {
		std::wstring post = L"function(o){var v=(o.values||{})[" + Js(Str(column)) + L"];return v==null?'':String(v);}";
		Result r = Call(L"getFields", {Js(Sep(comboSep))}, post);
		return Ret(result, r.ok ? r.payload : L"");
	}

	STDMETHOD(SetFieldValue)(BSTR column, BSTR value, BSTR comboSep, VARIANT_BOOL* result) {
		std::wstring values = L"{" + Js(Str(column)) + L":" + Js(Str(value)) + L"}";
		Result r = Call(L"setFields", {Js(values), Js(Sep(comboSep))}, L"function(o){return o.applied&&o.applied.length?'1':'0'}");
		return Ret(result, r.ok && r.payload == L"1");
	}

	/** "컬럼\t값" 줄 목록. DataWindow ImportString 으로 바로 넣을 수 있다. 값의 줄바꿈·탭은 \n, \t 두 글자로 바꾼다 */
	STDMETHOD(GetFieldsTsv)(BSTR comboSep, BSTR* result) {
		const wchar_t* post = LR"(function(o){var s='',v=o.values||{};for(var k in v){s+=k+'\t'+String(v[k]).replace(/\r\n/g,'\n').replace(/\n/g,'\\n').replace(/\t/g,'\\t')+'\r\n';}return s;})";
		Result r = Call(L"getFields", {Js(Sep(comboSep))}, post);
		return Ret(result, r.ok ? r.payload : L"");
	}

	STDMETHOD(GetTable)(BSTR* result) {
		Result r = Call(L"getSchema", {}, L"function(o){return o.table||''}");
		return Ret(result, r.ok ? r.payload : L"");
	}

	/** 인쇄 대화상자(미리보기)를 띄운다. 프린터·매수·쪽 범위는 사용자가 고른다 */
	STDMETHOD(Print)(VARIANT_BOOL* result) {
		if (!Call(L"preparePrint", {}).ok) return Ret(result, false);
		CComQIPtr<ICoreWebView2_16> w16(m_web);
		if (!w16) return Ret(result, Fail(L"이 WebView2 런타임은 인쇄 대화상자를 지원하지 않습니다 (109 이상 필요)"));
		HRESULT hr = w16->ShowPrintUI(COREWEBVIEW2_PRINT_DIALOG_KIND_BROWSER);
		return Ret(result, SUCCEEDED(hr) || Fail(L"인쇄 대화상자를 열 수 없습니다" + HrText(hr)));
	}

	/** 대화상자 없이 바로 인쇄. printerName 이 빈 문자열이면 기본 프린터 */
	STDMETHOD(PrintTo)(BSTR printerName, long copies, VARIANT_BOOL* result) {
		if (!Call(L"preparePrint", {}).ok) return Ret(result, false);
		CComQIPtr<ICoreWebView2_16> w16(m_web);
		CComPtr<ICoreWebView2PrintSettings> settings;
		if (!w16 || !NewPrintSettings(settings)) return Ret(result, Fail(L"이 WebView2 런타임은 바로 인쇄를 지원하지 않습니다 (109 이상 필요)"));
		std::wstring printer = Str(printerName);
		CComQIPtr<ICoreWebView2PrintSettings2> s2(settings);
		if (s2) {
			if (!printer.empty()) s2->put_PrinterName(printer.c_str());
			s2->put_Copies(copies < 1 ? 1 : copies);
		}
		bool done = false;
		HRESULT code = S_OK;
		COREWEBVIEW2_PRINT_STATUS status = COREWEBVIEW2_PRINT_STATUS_OTHER_ERROR;
		HRESULT hr = w16->Print(settings,
			Callback<ICoreWebView2PrintCompletedHandler>([&](HRESULT c, COREWEBVIEW2_PRINT_STATUS s) -> HRESULT {
				code = c;
				status = s;
				done = true;
				return S_OK;
			}).Get());
		if (FAILED(hr)) return Ret(result, Fail(L"인쇄 실패" + HrText(hr)));
		if (!Wait([&done] { return done; })) return Ret(result, Fail(L"인쇄 시간 초과"));
		if (SUCCEEDED(code) && status == COREWEBVIEW2_PRINT_STATUS_SUCCEEDED) return Ret(result, true);
		if (status == COREWEBVIEW2_PRINT_STATUS_PRINTER_UNAVAILABLE) return Ret(result, Fail(L"프린터를 쓸 수 없습니다: " + printer));
		return Ret(result, Fail(L"인쇄 실패" + HrText(code)));
	}

	/** 설치된 프린터 이름 (줄바꿈으로 구분) */
	STDMETHOD(GetPrinters)(BSTR* result) {
		DWORD needed = 0, count = 0;
		const DWORD flags = PRINTER_ENUM_LOCAL | PRINTER_ENUM_CONNECTIONS;
		EnumPrintersW(flags, nullptr, 4, nullptr, 0, &needed, &count);
		std::vector<BYTE> buf(needed ? needed : 1);
		std::wstring names;
		if (needed && EnumPrintersW(flags, nullptr, 4, buf.data(), needed, &needed, &count)) {
			auto* info = reinterpret_cast<PRINTER_INFO_4W*>(buf.data());
			for (DWORD i = 0; i < count; i++) {
				if (!names.empty()) names += L"\n";
				names += info[i].pPrinterName ? info[i].pPrinterName : L"";
			}
		}
		return Ret(result, names);
	}

	STDMETHOD(GetDefaultPrinter)(BSTR* result) {
		DWORD n = 0;
		::GetDefaultPrinterW(nullptr, &n);
		std::wstring name;
		if (n) {
			std::vector<wchar_t> buf(n);
			if (::GetDefaultPrinterW(buf.data(), &n)) name = buf.data();
		}
		return Ret(result, name);
	}

	/**
	 * 양식 입력에서 옮겨 다니는 키. 선택 개체(체크박스·라디오·드롭다운)와 누름틀 각각 다음/이전.
	 * 기본: Ctrl+Tab / Ctrl+Shift+Tab / Tab / Shift+Tab. "" 이면 바꾸지 않고 "none" 이면 끈다.
	 */
	STDMETHOD(SetKeys)(BSTR nextObject, BSTR prevObject, BSTR nextField, BSTR prevField, VARIANT_BOOL* result) {
		std::wstring map;
		auto put = [&map](const wchar_t* name, BSTR key) {
			std::wstring k = Str(key);
			if (k.empty()) return;
			if (Lower(k) == L"none") k.clear();
			if (!map.empty()) map += L",";
			map += Js(name) + L":" + Js(k);
		};
		put(L"nextObject", nextObject);
		put(L"prevObject", prevObject);
		put(L"nextField", nextField);
		put(L"prevField", prevField);
		return Ret(result, Call(L"setKeys", {Js(L"{" + map + L"}")}).ok);
	}

	/** 다음(1)/이전(-1) 선택 개체로 옮긴다. 옮겼으면 true */
	STDMETHOD(MoveObject)(long delta, VARIANT_BOOL* result) {
		return Ret(result, Call(L"moveObject", {delta < 0 ? L"-1" : L"1"}).ok);
	}

private:
	struct Result {
		bool ok = false;
		std::wstring error;
		std::wstring payload;
		/** 실패했을 때도 {"ok":false,"error":...} 모양을 돌려준다 */
		std::wstring Json() const {
			if (!payload.empty()) return payload;
			return ok ? L"{\"ok\":true}" : L"{\"ok\":false,\"error\":" + Js(error) + L"}";
		}
	};

	struct PendingEvent {
		DISPID id;
		std::wstring a, b;
	};

	CComPtr<ICoreWebView2Environment> m_env;
	CComPtr<ICoreWebView2Controller> m_controller;
	CComPtr<ICoreWebView2> m_web;
	bool m_ready = false;
	bool m_closed = false;
	std::wstring m_lastError;
	std::wstring m_status = L"컨트롤 창이 아직 만들어지지 않았습니다 (PB 가 컨트롤을 활성화하기 전)";
	std::wstring m_browserVersion;
	long m_timeout = 60;
	std::wstring m_webFolder;
	std::wstring m_folder;  // 실제로 쓰는 web 폴더
	std::wstring m_missing; // 마지막으로 못 찾은 화면 파일
	bool m_landscape = false;
	bool m_allowEdit = false;
	bool m_showMenu = false;
	int m_nextCallId = 0;
	int m_callDepth = 0;
	std::map<int, Result> m_results;
	std::vector<PendingEvent> m_events;

	static HRESULT Ret(VARIANT_BOOL* out, bool v) {
		if (!out) return E_POINTER;
		*out = Vb(v);
		return S_OK;
	}
	static HRESULT Ret(BSTR* out, const std::wstring& v) {
		if (!out) return E_POINTER;
		*out = Bstr(v);
		return S_OK;
	}

	bool Fail(const std::wstring& message) {
		m_lastError = message;
		if (!m_ready) m_status = L"오류: " + message;
		QueueEvent(3, message);
		return false;
	}

	// PB 이벤트는 WebView2 콜백 밖에서, 진행 중인 호출이 끝난 뒤에 보낸다 (재진입 방지)
	void QueueEvent(DISPID id, const std::wstring& a = L"", const std::wstring& b = L"") {
		m_events.push_back({id, a, b});
		if (IsWindow()) PostMessage(WM_HWPX_EVENTS);
	}

	LRESULT OnHwpxEvents(UINT, WPARAM, LPARAM, BOOL&) {
		if (m_callDepth > 0) return 0;  // 호출이 끝나면 다시 보낸다
		std::vector<PendingEvent> events;
		events.swap(m_events);
		for (auto& e : events) {
			if (e.id == 1) {
				FireDispEvent(1, nullptr, 0);
			} else if (e.id == 2) {
				CComVariant args[2] = {CComVariant(e.b.c_str()), CComVariant(e.a.c_str())};  // table, fileName (역순)
				FireDispEvent(2, args, 2);
			} else {
				CComVariant arg(e.a.c_str());
				FireDispEvent(3, &arg, 1);
			}
		}
		return 0;
	}

	// ---- WebView2 ------------------------------------------------------------------

	LRESULT OnCreate(UINT, WPARAM, LPARAM, BOOL& handled) {
		handled = FALSE;
		InitWebView();
		return 0;
	}

	LRESULT OnSize(UINT, WPARAM, LPARAM, BOOL& handled) {
		handled = FALSE;
		Resize();
		return 0;
	}

	LRESULT OnFocus(UINT, WPARAM, LPARAM, BOOL& handled) {
		handled = FALSE;
		if (m_controller) m_controller->MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);
		return 0;
	}

	LRESULT OnDestroy(UINT, WPARAM, LPARAM, BOOL& handled) {
		handled = FALSE;
		CloseWebView();
		return 0;
	}

	void Resize() {
		if (!m_controller || !IsWindow()) return;
		RECT rc;
		GetClientRect(&rc);
		m_controller->put_Bounds(rc);
	}

	void CloseWebView() {
		m_ready = false;
		m_closed = true;
		if (m_controller) m_controller->Close();
		m_controller.Release();
		m_web.Release();
		m_env.Release();
	}

	void InitWebView() {
		m_closed = false;
		std::wstring base = ModuleDir();
		// 설치 폴더에 webview2\ (고정 버전 런타임)가 있으면 그것을 쓴다. 없으면 PC 에 설치된 런타임
		std::wstring fixed = base + L"\\webview2";
		bool useFixed = FileExists(fixed + L"\\msedgewebview2.exe");
		std::wstring dataDir = LocalAppData() + L"\\hwpxpb\\WebView2";
		CComPtr<IUnknown> keep(GetUnknown());

		LPWSTR version = nullptr;
		HRESULT hv = GetAvailableCoreWebView2BrowserVersionString(useFixed ? fixed.c_str() : nullptr, &version);
		if (FAILED(hv) || !version) {
			Fail(useFixed ? L"webview2 폴더의 런타임을 쓸 수 없습니다: " + fixed + HrText(hv)
			              : L"WebView2 런타임이 설치되어 있지 않습니다 (Windows 7 은 109 버전 설치 또는 webview2 폴더에 고정 버전)" + HrText(hv));
			if (version) CoTaskMemFree(version);
			return;
		}
		m_browserVersion = version;
		CoTaskMemFree(version);
		m_status = L"WebView2 시작 중 (런타임 " + m_browserVersion + (useFixed ? L", 고정 버전)" : L")");

		HRESULT hr = CreateCoreWebView2EnvironmentWithOptions(useFixed ? fixed.c_str() : nullptr, dataDir.c_str(), nullptr,
			Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>(
				[this, keep](HRESULT result, ICoreWebView2Environment* env) -> HRESULT {
					if (m_closed) return S_OK;
					if (FAILED(result) || !env) {
						Fail(L"WebView2 초기화 실패: WebView2 런타임이 설치되어 있는지 확인하세요" + HrText(result));
						return S_OK;
					}
					m_env = env;
					m_status = L"WebView2 화면 만드는 중";
					HRESULT hr2 = env->CreateCoreWebView2Controller(m_hWnd,
						Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
							[this, keep](HRESULT r, ICoreWebView2Controller* controller) -> HRESULT {
								if (m_closed) {
									if (controller) controller->Close();
									return S_OK;
								}
								if (FAILED(r) || !controller) {
									Fail(L"WebView2 초기화 실패" + HrText(r));
									return S_OK;
								}
								m_controller = controller;
								m_controller->get_CoreWebView2(&m_web);
								Resize();
								Navigate();
								return S_OK;
							}).Get());
					if (FAILED(hr2)) Fail(L"WebView2 초기화 실패" + HrText(hr2));
					return S_OK;
				}).Get());
		if (FAILED(hr)) Fail(L"WebView2 초기화 실패: WebView2 런타임이 설치되어 있는지 확인하세요" + HrText(hr));
	}

	void Navigate() {
		if (!m_web) return;
		CComPtr<ICoreWebView2Settings> settings;
		if (SUCCEEDED(m_web->get_Settings(&settings)) && settings) {
			settings->put_AreDefaultContextMenusEnabled(FALSE);
			settings->put_AreDevToolsEnabled(FALSE);
			settings->put_IsStatusBarEnabled(FALSE);
		}
		CComQIPtr<ICoreWebView2_3> w3(m_web);
		if (!w3) {
			Fail(L"WebView2 런타임이 너무 오래됐습니다");
			return;
		}
		std::wstring folder = m_webFolder.empty() ? ModuleDir() + L"\\web" : m_webFolder;
		if (!FileExists(folder + L"\\index.html")) {
			Fail(L"에디터 화면 폴더가 없습니다: " + folder + L"\\index.html (zip 의 web 폴더를 OCX 옆에 두세요)");
			return;
		}
		// 가상 호스트 매핑(SetVirtualHostNameToFolderMapping) 대신 요청을 직접 받아 파일을 돌려준다.
		// Windows 7 + 109 런타임에서 매핑이 "파일 없음" 페이지를 내는 경우가 있어서, 경로 문제를 Status 로 보이게 한다.
		m_folder = folder;
		EventRegistrationToken token;
		m_web->AddWebResourceRequestedFilter((std::wstring(L"https://") + kHost + L"/*").c_str(), COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL);
		m_web->add_WebResourceRequested(
			Callback<ICoreWebView2WebResourceRequestedEventHandler>(
				[this](ICoreWebView2*, ICoreWebView2WebResourceRequestedEventArgs* args) -> HRESULT {
					ServeFile(args);
					return S_OK;
				}).Get(),
			&token);
		m_web->add_WebMessageReceived(
			Callback<ICoreWebView2WebMessageReceivedEventHandler>(
				[this](ICoreWebView2*, ICoreWebView2WebMessageReceivedEventArgs* args) -> HRESULT {
					LPWSTR message = nullptr;
					if (SUCCEEDED(args->TryGetWebMessageAsString(&message)) && message) {
						OnMessage(message);
						CoTaskMemFree(message);
					}
					return S_OK;
				}).Get(),
			&token);
		// 화면 스크립트 오류를 PB 쪽에서 볼 수 있게 (Status / LastError)
		m_web->AddScriptToExecuteOnDocumentCreated(
			L"(function(){\n"
			L"var top=window.top===window;\n"
			L"// 서비스 워커는 쓰지 않는다 (OCX 는 파일을 직접 넘겨 주므로 캐시가 오히려 방해)\n"
			L"try{if(navigator.serviceWorker){navigator.serviceWorker.register=function(){return new Promise(function(){});};\n"
			L"navigator.serviceWorker.getRegistrations().then(function(rs){rs.forEach(function(r){r.unregister();});});}}catch(e){}\n"
			L"var where=top?'':'[studio] ';\n"
			L"function s(m,post){m=where+String(m);try{var T=window.top;(T.__hwpxErrs=T.__hwpxErrs||[]).push(m);if(T.__hwpxShow)T.__hwpxShow();}catch(e){}\n"
			L"if(post===false)return;try{(window.top.chrome||window.chrome).webview.postMessage(JSON.stringify({event:'jserror',message:m}));}catch(e){}}\n"
			L"window.addEventListener('error',function(e){var t=e.target;\n"
			L"if(t&&t!==window&&(t.src||t.href)){s('파일을 읽지 못함: '+(t.src||t.href));return;}\n"
			L"s((e.message||'error')+' @'+(e.filename||'')+':'+(e.lineno||0));},true);\n"
			L"window.addEventListener('unhandledrejection',function(e){var r=e.reason;s('Promise: '+(r&&(r.stack||r.message)||r));});\n"
			L"// 콘솔 오류도 모은다 (에디터가 잡아서 콘솔에만 남기는 오류)\n"
			L"['error','warn'].forEach(function(k){var o=console[k];console[k]=function(){try{s('console.'+k+': '+Array.prototype.map.call(arguments,function(a){return a&&a.stack?a.stack:(typeof a==='object'?JSON.stringify(a):String(a));}).join(' '),false);}catch(e){}return o.apply(console,arguments);};});\n"
			L"if(!top)return;\n"
			L"var t0=Date.now(),box=null;\n"
			L"function info(){var f=document.querySelector('#editor iframe'),d='없음';\n"
			L"if(f){var st='?',rs='?';try{st=f.contentDocument?f.contentDocument.readyState:'문서 없음';rs=f.contentWindow&&f.contentWindow.rhwpStudio?'있음':'없음';}catch(e){st='접근 불가 '+e.message;}\n"
			L"d=f.src+' / '+st+' / rhwpStudio '+rs;}\n"
			L"return '경과 '+Math.round((Date.now()-t0)/1000)+'초 / hwpBridge '+(window.hwpBridge?'있음':'없음')+' / bridgeReady '+(window.hwpBridgeReady?'예':'아니오')+'\\n편집기 iframe: '+d;}\n"
			L"window.__hwpxShow=function(){if(!box||window.__hwpxReady)return;var errs=window.__hwpxErrs||[];\n"
			L"box.textContent='에디터가 시작되지 않았습니다. 아래 내용을 보내 주세요.\\n'+navigator.userAgent+'\\n'+info()+'\\n'+(errs.length?errs.slice(-30).join('\\n'):'(스크립트 오류 없음)');};\n"
			L"// 20초 안에 준비되지 않으면 원인을 화면에 직접 보여 주고, 이후 2초마다 갱신한다\n"
			L"setTimeout(function(){if(window.__hwpxReady)return;box=document.createElement('pre');\n"
			L"box.style.cssText='position:fixed;left:0;top:0;right:0;z-index:2147483647;margin:0;padding:10px;background:#fff3f3;color:#b42318;font:12px/1.5 monospace;white-space:pre-wrap;word-break:break-all;border-bottom:2px solid #b42318;max-height:80%;overflow:auto;user-select:text';\n"
			L"(document.body||document.documentElement).appendChild(box);window.__hwpxShow();\n"
			L"var iv=setInterval(function(){if(window.__hwpxReady){clearInterval(iv);box.remove();return;}window.__hwpxShow();},2000);},20000);\n"
			L"})();\n",
			nullptr);
		m_web->add_NavigationCompleted(
			Callback<ICoreWebView2NavigationCompletedEventHandler>(
				[this](ICoreWebView2*, ICoreWebView2NavigationCompletedEventArgs* args) -> HRESULT {
					BOOL ok = FALSE;
					args->get_IsSuccess(&ok);
					if (ok) {
						if (!m_ready) m_status = L"화면 열림, 에디터 시작 중";
					} else {
						COREWEBVIEW2_WEB_ERROR_STATUS st = COREWEBVIEW2_WEB_ERROR_STATUS_UNKNOWN;
						args->get_WebErrorStatus(&st);
						Fail(L"에디터 화면을 열지 못했습니다 (WebErrorStatus " + std::to_wstring(static_cast<int>(st)) + L")" +
						     (m_missing.empty() ? L"" : L" 못 찾은 파일: " + m_missing));
					}
					return S_OK;
				}).Get(),
			&token);
		m_status = L"에디터 화면 여는 중: " + folder;
		m_web->Navigate((std::wstring(L"https://") + kHost + L"/index.html").c_str());
	}

	static const wchar_t* MimeType(const std::wstring& path) {
		static const struct { const wchar_t* ext; const wchar_t* type; } types[] = {
			{L".html", L"text/html; charset=utf-8"}, {L".js", L"text/javascript; charset=utf-8"},
			{L".mjs", L"text/javascript; charset=utf-8"}, {L".css", L"text/css; charset=utf-8"},
			{L".wasm", L"application/wasm"}, {L".json", L"application/json"},
			{L".webmanifest", L"application/manifest+json"}, {L".svg", L"image/svg+xml"},
			{L".png", L"image/png"}, {L".ico", L"image/x-icon"}, {L".woff2", L"font/woff2"},
			{L".woff", L"font/woff"}, {L".ttf", L"font/ttf"}, {L".txt", L"text/plain; charset=utf-8"},
		};
		size_t dot = path.find_last_of(L'.');
		if (dot != std::wstring::npos) {
			std::wstring ext = path.substr(dot);
			for (auto& c : ext) c = static_cast<wchar_t>(towlower(c));
			for (auto& t : types)
				if (ext == t.ext) return t.type;
		}
		return L"application/octet-stream";
	}

	void ServeFile(ICoreWebView2WebResourceRequestedEventArgs* args) {
		if (!m_env) return;
		CComPtr<ICoreWebView2WebResourceRequest> request;
		LPWSTR uri = nullptr;
		if (FAILED(args->get_Request(&request)) || !request || FAILED(request->get_Uri(&uri)) || !uri) return;
		std::wstring u = uri;
		CoTaskMemFree(uri);
		std::wstring prefix = std::wstring(L"https://") + kHost + L"/";
		if (u.compare(0, prefix.size(), prefix) != 0) return;
		std::wstring rel = u.substr(prefix.size());
		size_t cut = rel.find_first_of(L"?#");
		if (cut != std::wstring::npos) rel = rel.substr(0, cut);
		rel = UrlDecode(rel);
		for (auto& c : rel)
			if (c == L'/') c = L'\\';
		// 폴더 주소(예: /studio/)는 그 안의 index.html
		if (rel.empty() || rel.back() == L'\\') rel += L"index.html";
		CComPtr<ICoreWebView2WebResourceResponse> response;
		CComPtr<IStream> stream;
		std::wstring path = m_folder + L"\\" + rel;
		bool bad = rel.find(L"..") != std::wstring::npos;
		if (!bad && SUCCEEDED(SHCreateStreamOnFileEx(path.c_str(), STGM_READ | STGM_SHARE_DENY_WRITE, FILE_ATTRIBUTE_NORMAL, FALSE, nullptr, &stream))) {
			std::wstring headers = std::wstring(L"Content-Type: ") + MimeType(rel) + L"\r\nAccess-Control-Allow-Origin: *\r\nCache-Control: no-cache";
			m_env->CreateWebResourceResponse(stream, 200, L"OK", headers.c_str(), &response);
		} else if (rel == L"favicon.ico") {
			// 브라우저가 자동으로 찾는 아이콘. 없어도 되므로 상태에 남기지 않는다
			m_env->CreateWebResourceResponse(nullptr, 204, L"No Content", L"", &response);
		} else {
			m_missing = path;
			if (!m_ready) m_status = L"화면 파일을 찾지 못했습니다: " + path;
			m_env->CreateWebResourceResponse(nullptr, 404, L"Not Found", L"Content-Type: text/plain", &response);
		}
		if (response) args->put_Response(response);
	}

	void OnMessage(const std::wstring& m) {
		// 호출 결과: R<id>|<ok 1/0>|<encodeURIComponent(error)>|<payload>
		if (!m.empty() && m[0] == L'R') {
			size_t p1 = m.find(L'|');
			size_t p2 = p1 == std::wstring::npos ? p1 : m.find(L'|', p1 + 1);
			size_t p3 = p2 == std::wstring::npos ? p2 : m.find(L'|', p2 + 1);
			if (p3 == std::wstring::npos) return;
			Result r;
			r.ok = m.substr(p1 + 1, p2 - p1 - 1) == L"1";
			r.error = UrlDecode(m.substr(p2 + 1, p3 - p2 - 1));
			r.payload = m.substr(p3 + 1);
			m_results[_wtoi(m.substr(1, p1 - 1).c_str())] = r;
			return;
		}
		// bridge.js 의 이벤트: {"event":"ready"} 등
		std::wstring ev = JsonString(m, L"event");
		if (ev == L"ready") {
			// 권한을 먼저 넘긴 뒤 PB 에 Ready 를 알린다
			m_web->ExecuteScript((std::wstring(L"window.hwpBridge.setShowMenu(") + (m_showMenu ? L"true" : L"false") + L").then(function(){return window.hwpBridge.setPermission(" + (m_allowEdit ? L"true" : L"false") + L")})").c_str(), nullptr);
			m_web->ExecuteScript(L"window.__hwpxReady=true", nullptr);
			m_ready = true;
			m_status = L"준비됨";
			QueueEvent(1);
		} else if (ev == L"jserror") {
			std::wstring msg = L"화면 스크립트 오류: " + JsonString(m, L"message");
			if (m_ready) {
				m_lastError = msg;
			} else {
				Fail(msg);
			}
		} else if (ev == L"loaded") {
			QueueEvent(2, JsonString(m, L"fileName"), JsonString(m, L"table"));
		}
	}

	/**
	 * window.hwpBridge.method(args) 를 부르고 결과를 기다린다. args 는 JS 식(문자열은 Js() 로 감쌀 것).
	 * post 를 주면 결과 객체 o 에 그 JS 함수를 적용한 문자열을 payload 로 받는다. 없으면 결과 JSON 그대로.
	 */
	Result Call(const wchar_t* method, std::initializer_list<std::wstring> args, const std::wstring& post = L"") {
		Result r;
		if (!m_ready || !m_web) {
			r.error = L"에디터가 아직 준비되지 않았습니다 (Ready 이벤트 후 호출하세요)";
			Fail(r.error);
			return r;
		}
		int id = ++m_nextCallId;
		std::wstring argList;
		for (auto& a : args) {
			if (!argList.empty()) argList += L",";
			argList += a;
		}
		std::wstring sid = std::to_wstring(id);
		std::wstring script =
			L"(function(){"
			L"function send(ok,err,out){window.chrome.webview.postMessage('R" + sid + L"|'+(ok?'1':'0')+'|'+encodeURIComponent(err||'')+'|'+(out==null?'':out));}"
			L"var P=" + (post.empty() ? std::wstring(L"null") : post) + L";"
			L"try{Promise.resolve(window.hwpBridge." + method + L"(" + argList + L")).then(function(s){"
			L"var o=null;try{o=JSON.parse(s);}catch(e){}"
			L"var out=s;if(P){try{out=String(P(o||{}));}catch(e){out='';}}"
			L"send(!(o&&o.ok===false),o&&o.error,out);"
			L"},function(e){send(false,String(e&&e.message||e),'');});"
			L"}catch(e){send(false,String(e&&e.message||e),'');}"
			L"})();";
		m_callDepth++;
		HRESULT hr = m_web->ExecuteScript(script.c_str(), nullptr);
		bool arrived = SUCCEEDED(hr) && Wait([this, id] { return m_results.count(id) > 0; });
		m_callDepth--;
		if (!m_events.empty() && m_callDepth == 0 && IsWindow()) PostMessage(WM_HWPX_EVENTS);
		if (!arrived) {
			m_results.erase(id);
			r.error = FAILED(hr) ? L"스크립트 실행 실패" + HrText(hr) : L"에디터 응답 시간 초과";
			Fail(r.error);
			return r;
		}
		r = m_results[id];
		m_results.erase(id);
		if (!r.ok) Fail(r.error);
		return r;
	}

	/** PB 의 UI 스레드를 막지 않도록 메시지를 돌리면서 기다린다 */
	template <class F>
	bool Wait(F done) {
		ULONGLONG until = GetTickCount64() + static_cast<ULONGLONG>(m_timeout > 0 ? m_timeout : 60) * 1000;
		while (!done()) {
			if (GetTickCount64() > until) return false;
			MSG msg;
			while (PeekMessageW(&msg, nullptr, 0, 0, PM_REMOVE)) {
				if (msg.message == WM_QUIT) {
					PostQuitMessage(static_cast<int>(msg.wParam));
					return false;
				}
				TranslateMessage(&msg);
				DispatchMessageW(&msg);
				if (done()) return true;
			}
			MsgWaitForMultipleObjectsEx(0, nullptr, 10, QS_ALLINPUT, MWMO_INPUTAVAILABLE);
		}
		return true;
	}

	bool NewPrintSettings(CComPtr<ICoreWebView2PrintSettings>& settings) {
		CComQIPtr<ICoreWebView2Environment6> env6(m_env);
		if (!env6 || FAILED(env6->CreatePrintSettings(&settings)) || !settings) return false;
		settings->put_Orientation(m_landscape ? COREWEBVIEW2_PRINT_ORIENTATION_LANDSCAPE : COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT);
		settings->put_MarginTop(0);
		settings->put_MarginBottom(0);
		settings->put_MarginLeft(0);
		settings->put_MarginRight(0);
		settings->put_ShouldPrintBackgrounds(TRUE);
		settings->put_ShouldPrintHeaderAndFooter(FALSE);
		return true;
	}
};

OBJECT_ENTRY_AUTO(__uuidof(HwpxEditorControl), CHwpxEditor)

// ---- DLL --------------------------------------------------------------------------

class CHwpxpbModule : public CAtlDllModuleT<CHwpxpbModule> {
public:
	DECLARE_LIBID(LIBID_HwpxpbLib)
};

CHwpxpbModule _AtlModule;

extern "C" BOOL WINAPI DllMain(HINSTANCE, DWORD reason, LPVOID reserved) {
	return _AtlModule.DllMain(reason, reserved);
}

STDAPI DllCanUnloadNow() { return _AtlModule.DllCanUnloadNow(); }

STDAPI DllGetClassObject(REFCLSID rclsid, REFIID riid, LPVOID* ppv) { return _AtlModule.DllGetClassObject(rclsid, riid, ppv); }

STDAPI DllRegisterServer() { return _AtlModule.DllRegisterServer(); }

STDAPI DllUnregisterServer() { return _AtlModule.DllUnregisterServer(); }
