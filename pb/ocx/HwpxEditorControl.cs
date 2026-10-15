// PowerBuilder 12.1 에서 OLE 컨트롤로 쓰는 HWPX 에디터 (WebView2 기반 ActiveX).
//
// - 화면: 설치 폴더의 web\ (pb/dist) 를 https://hwpxpb.local/ 로 연다. 네트워크가 필요 없다.
// - PB → 에디터: 아래 공개 메서드. 모두 동기식이며 결과는 JSON 문자열 또는 bool.
// - 에디터 → PB: Ready / Loaded / ErrorOccurred 이벤트.
//
// 빌드: x86 (PB 12.1 은 32비트), .NET Framework 4.8, NuGet Microsoft.Web.WebView2
// 등록: regasm /codebase /tlb HwpxEditorOcx.dll  (관리자 권한, 32비트 regasm)
using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using Microsoft.Win32;

namespace Hwpxpb
{
    [ComVisible(true)]
    [Guid("6B2E7C1A-3F4D-4E8B-9A51-2C7D0E9F1A01")]
    [InterfaceType(ComInterfaceType.InterfaceIsDual)]
    public interface IHwpxEditor
    {
        [DispId(1)] bool Open(string path, string mode);
        [DispId(2)] bool OpenBase64(string base64, string fileName, string mode);
        [DispId(3)] bool SetMode(string mode);
        [DispId(4)] string GetSchema();
        [DispId(5)] string SetFields(string valuesJson, string comboSep);
        [DispId(6)] string GetFields(string comboSep);
        [DispId(7)] bool SaveAs(string path, string comboSep);
        [DispId(8)] string GetDocumentBase64(string comboSep);
        [DispId(9)] bool SavePdf(string path);
        [DispId(10)] string LastError { get; }
        [DispId(11)] bool IsReady { get; }
        [DispId(12)] int TimeoutSeconds { get; set; }
        [DispId(13)] string WebFolder { get; set; }
        [DispId(14)] bool PdfLandscape { get; set; }
        // PB 12.1 에는 JSON 파서가 없으므로 JSON 없이 쓰는 메서드
        [DispId(20)] string GetFieldValue(string column, string comboSep);
        [DispId(21)] bool SetFieldValue(string column, string value, string comboSep);
        [DispId(22)] string GetFieldsTsv(string comboSep);
        [DispId(23)] string GetTable();
        // 출력 (빈 칸 안내문은 찍지 않는다)
        [DispId(24)] bool Print();
        [DispId(25)] bool PrintTo(string printerName, int copies);
        [DispId(26)] string GetPrinters();
        [DispId(27)] string GetDefaultPrinter();
        // 양식 입력 이동 키 (예: "Ctrl+Tab", "F8"). "" 이면 그대로, "none" 이면 끔
        [DispId(28)] bool SetKeys(string nextObject, string prevObject, string nextField, string prevField);
        [DispId(29)] bool MoveObject(int delta);
    }

    [ComVisible(true)]
    [Guid("6B2E7C1A-3F4D-4E8B-9A51-2C7D0E9F1A02")]
    [InterfaceType(ComInterfaceType.InterfaceIsIDispatch)]
    public interface IHwpxEditorEvents
    {
        [DispId(1)] void Ready();
        [DispId(2)] void Loaded(string fileName, string table);
        [DispId(3)] void ErrorOccurred(string message);
    }

    public delegate void ReadyHandler();
    public delegate void LoadedHandler(string fileName, string table);
    public delegate void ErrorHandler(string message);

    [ComVisible(true)]
    [Guid("6B2E7C1A-3F4D-4E8B-9A51-2C7D0E9F1A03")]
    [ProgId("Hwpxpb.Editor")]
    [ClassInterface(ClassInterfaceType.None)]
    [ComDefaultInterface(typeof(IHwpxEditor))]
    [ComSourceInterfaces(typeof(IHwpxEditorEvents))]
    public class HwpxEditorControl : UserControl, IHwpxEditor
    {
        public event ReadyHandler Ready;
        public event LoadedHandler Loaded;
        public event ErrorHandler ErrorOccurred;

        private const string Host = "hwpxpb.local";
        private readonly WebView2 _web = new WebView2 { Dock = DockStyle.Fill };
        private readonly JavaScriptSerializer _json = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };
        private readonly Dictionary<int, TaskCompletionSource<string>> _pending = new Dictionary<int, TaskCompletionSource<string>>();
        private int _nextCallId;
        private bool _ready;
        private string _lastError = "";

        public int TimeoutSeconds { get; set; } = 60;
        public string WebFolder { get; set; }
        public bool PdfLandscape { get; set; }
        public string LastError => _lastError;
        public bool IsReady => _ready;

        public HwpxEditorControl()
        {
            Controls.Add(_web);
            HandleCreated += async (s, e) => await InitAsync();
        }

        private async Task InitAsync()
        {
            try
            {
                var dataDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "hwpxpb", "WebView2");
                var env = await CoreWebView2Environment.CreateAsync(null, dataDir);
                await _web.EnsureCoreWebView2Async(env);
                var folder = WebFolder;
                if (string.IsNullOrEmpty(folder))
                    folder = Path.Combine(Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location), "web");
                _web.CoreWebView2.SetVirtualHostNameToFolderMapping(Host, folder, CoreWebView2HostResourceAccessKind.Allow);
                _web.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
                _web.CoreWebView2.Settings.AreDevToolsEnabled = false;
                _web.CoreWebView2.WebMessageReceived += OnWebMessage;
                _web.CoreWebView2.Navigate("https://" + Host + "/index.html");
            }
            catch (Exception ex)
            {
                Fail("WebView2 초기화 실패: " + ex.Message);
            }
        }

        private void OnWebMessage(object sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            Dictionary<string, object> msg;
            try { msg = _json.Deserialize<Dictionary<string, object>>(e.TryGetWebMessageAsString()); }
            catch { return; }

            if (msg.TryGetValue("callId", out var idObj))
            {
                var id = Convert.ToInt32(idObj);
                if (_pending.TryGetValue(id, out var tcs))
                {
                    _pending.Remove(id);
                    tcs.TrySetResult(msg.TryGetValue("result", out var r) ? r as string : null);
                }
                return;
            }
            switch (msg.TryGetValue("event", out var ev) ? ev as string : null)
            {
                case "ready":
                    _ready = true;
                    Ready?.Invoke();
                    break;
                case "loaded":
                    Loaded?.Invoke(Str(msg, "fileName"), Str(msg, "table"));
                    break;
            }
        }

        private static string Str(Dictionary<string, object> d, string k) => d.TryGetValue(k, out var v) ? v as string ?? "" : "";

        // ---- PB 에서 부르는 메서드 ------------------------------------------------

        public bool Open(string path, string mode)
        {
            try { return OpenBase64(Convert.ToBase64String(File.ReadAllBytes(path)), Path.GetFileName(path), mode); }
            catch (Exception ex) { return Fail(ex.Message); }
        }

        public bool OpenBase64(string base64, string fileName, string mode) =>
            Ok(Call("open", base64, fileName ?? "document.hwpx", Mode(mode)));

        public bool SetMode(string mode) => Ok(Call("setMode", Mode(mode)));

        public string GetSchema() => Call("getSchema");

        public string SetFields(string valuesJson, string comboSep) => Call("setFields", valuesJson ?? "{}", Sep(comboSep));

        public string GetFields(string comboSep) => Call("getFields", Sep(comboSep));

        public string GetFieldValue(string column, string comboSep)
        {
            var values = Values(GetFields(comboSep));
            return values != null && values.TryGetValue(column ?? "", out var v) ? Convert.ToString(v) : "";
        }

        public bool SetFieldValue(string column, string value, string comboSep)
        {
            var r = Parse(SetFields(_json.Serialize(new Dictionary<string, string> { [column ?? ""] = value ?? "" }), comboSep));
            return r != null && r.TryGetValue("applied", out var a) && a is System.Collections.ArrayList list && list.Count > 0;
        }

        /// <summary>"컬럼\t값" 줄 목록. DataWindow ImportString 으로 바로 넣을 수 있다. 값의 줄바꿈·탭은 \n, \t 두 글자로 바꾼다.</summary>
        public string GetFieldsTsv(string comboSep)
        {
            var values = Values(GetFields(comboSep));
            if (values == null) return "";
            var sb = new System.Text.StringBuilder();
            foreach (var kv in values)
            {
                var v = Convert.ToString(kv.Value).Replace("\r\n", "\n").Replace("\n", "\\n").Replace("\t", "\\t");
                sb.Append(kv.Key).Append('\t').Append(v).Append("\r\n");
            }
            return sb.ToString();
        }

        public string GetTable()
        {
            var r = Parse(GetSchema());
            return r != null && r.TryGetValue("table", out var t) ? t as string ?? "" : "";
        }

        private Dictionary<string, object> Values(string fieldsJson)
        {
            var r = Parse(fieldsJson);
            return r != null && r.TryGetValue("values", out var v) ? v as Dictionary<string, object> : null;
        }

        public string GetDocumentBase64(string comboSep)
        {
            var r = Parse(Call("getDocument", Sep(comboSep)));
            return r != null && r.TryGetValue("hwpx", out var b) ? b as string : "";
        }

        public bool SaveAs(string path, string comboSep)
        {
            try
            {
                var b64 = GetDocumentBase64(comboSep);
                if (string.IsNullOrEmpty(b64)) return false;
                File.WriteAllBytes(path, Convert.FromBase64String(b64));
                return true;
            }
            catch (Exception ex) { return Fail(ex.Message); }
        }

        /// <summary>
        /// 양식 입력에서 옮겨 다니는 키. 선택 개체(체크박스·라디오·드롭다운)와 누름틀 각각 다음/이전.
        /// 기본: Ctrl+Tab / Ctrl+Shift+Tab / Tab / Shift+Tab. "" 이면 바꾸지 않고 "none" 이면 끈다.
        /// </summary>
        public bool SetKeys(string nextObject, string prevObject, string nextField, string prevField)
        {
            var map = new Dictionary<string, object>();
            void Put(string name, string key)
            {
                if (string.IsNullOrEmpty(key)) return;
                map[name] = string.Equals(key, "none", StringComparison.OrdinalIgnoreCase) ? "" : key;
            }
            Put("nextObject", nextObject);
            Put("prevObject", prevObject);
            Put("nextField", nextField);
            Put("prevField", prevField);
            return Ok(Call("setKeys", _json.Serialize(map)));
        }

        /// <summary>다음(1)/이전(-1) 선택 개체로 옮긴다. 옮겼으면 true</summary>
        public bool MoveObject(int delta)
        {
            return Ok(Call("moveObject", delta < 0 ? "-1" : "1"));
        }

        /// <summary>인쇄 대화상자(미리보기)를 띄운다. 프린터·매수·쪽 범위는 사용자가 고른다.</summary>
        public bool Print()
        {
            if (!Ok(Call("preparePrint"))) return false;
            try
            {
                _web.CoreWebView2.ShowPrintUI(CoreWebView2PrintDialogKind.Browser);
                return true;
            }
            catch (Exception ex) { return Fail(ex.Message); }
        }

        /// <summary>대화상자 없이 바로 인쇄. printerName 이 빈 문자열이면 기본 프린터.</summary>
        public bool PrintTo(string printerName, int copies)
        {
            if (!Ok(Call("preparePrint"))) return false;
            try
            {
                var settings = NewPrintSettings();
                if (!string.IsNullOrEmpty(printerName)) settings.PrinterName = printerName;
                settings.Copies = copies < 1 ? 1 : copies;
                var status = Wait(_web.CoreWebView2.PrintAsync(settings));
                switch (status)
                {
                    case CoreWebView2PrintStatus.Succeeded: return true;
                    case CoreWebView2PrintStatus.PrinterUnavailable: return Fail("프린터를 쓸 수 없습니다: " + printerName);
                    default: return Fail("인쇄 실패");
                }
            }
            catch (Exception ex) { return Fail(ex.Message); }
        }

        /// <summary>설치된 프린터 이름 (줄바꿈으로 구분)</summary>
        public string GetPrinters()
        {
            var names = new List<string>();
            foreach (string n in System.Drawing.Printing.PrinterSettings.InstalledPrinters) names.Add(n);
            return string.Join("\n", names);
        }

        public string GetDefaultPrinter()
        {
            return new System.Drawing.Printing.PrinterSettings().PrinterName;
        }

        private CoreWebView2PrintSettings NewPrintSettings()
        {
            var settings = _web.CoreWebView2.Environment.CreatePrintSettings();
            settings.Orientation = PdfLandscape ? CoreWebView2PrintOrientation.Landscape : CoreWebView2PrintOrientation.Portrait;
            settings.MarginTop = settings.MarginBottom = settings.MarginLeft = settings.MarginRight = 0;
            settings.ShouldPrintBackgrounds = true;
            settings.ShouldPrintHeaderAndFooter = false;
            return settings;
        }

        public bool SavePdf(string path)
        {
            if (!Ok(Call("preparePrint"))) return false;
            try
            {
                var settings = NewPrintSettings();
                var ok = Wait(_web.CoreWebView2.PrintToPdfAsync(path, settings));
                return ok || Fail("PDF 저장 실패: " + path);
            }
            catch (Exception ex) { return Fail(ex.Message); }
        }

        // ---- 내부 -------------------------------------------------------------

        /// <summary>window.hwpBridge.method(...args) 를 부르고 결과(JSON 문자열)를 기다린다.</summary>
        private string Call(string method, params string[] args)
        {
            if (!_ready)
            {
                Fail("에디터가 아직 준비되지 않았습니다 (Ready 이벤트 후 호출하세요)");
                return "{\"ok\":false,\"error\":\"not ready\"}";
            }
            var id = ++_nextCallId;
            var tcs = new TaskCompletionSource<string>();
            _pending[id] = tcs;
            var argList = string.Join(",", Array.ConvertAll(args, a => _json.Serialize(a)));
            var script =
                "window.hwpBridge." + method + "(" + argList + ").then(function(r){" +
                "window.chrome.webview.postMessage(JSON.stringify({callId:" + id + ",result:r}));});";
            _web.CoreWebView2.ExecuteScriptAsync(script);
            try
            {
                var result = Wait(tcs.Task) ?? "{\"ok\":false,\"error\":\"no result\"}";
                var parsed = Parse(result);
                if (parsed != null && parsed.TryGetValue("ok", out var ok) && ok is bool b && !b)
                    Fail(Str(parsed, "error"));
                return result;
            }
            catch (Exception ex)
            {
                _pending.Remove(id);
                Fail(ex.Message);
                return _json.Serialize(new { ok = false, error = ex.Message });
            }
        }

        /// <summary>PB 의 UI 스레드를 막지 않도록 메시지를 돌리면서 기다린다.</summary>
        private T Wait<T>(Task<T> task)
        {
            var until = DateTime.UtcNow.AddSeconds(TimeoutSeconds);
            while (!task.IsCompleted)
            {
                if (DateTime.UtcNow > until) throw new TimeoutException("에디터 응답 시간 초과");
                Application.DoEvents();
                System.Threading.Thread.Sleep(5);
            }
            return task.GetAwaiter().GetResult();
        }

        private Dictionary<string, object> Parse(string json)
        {
            try { return _json.Deserialize<Dictionary<string, object>>(json); }
            catch { return null; }
        }

        private bool Ok(string json)
        {
            var r = Parse(json);
            return r != null && r.TryGetValue("ok", out var ok) && ok is bool b && b;
        }

        private bool Fail(string message)
        {
            _lastError = message ?? "";
            ErrorOccurred?.Invoke(_lastError);
            return false;
        }

        private static string Mode(string m) => string.IsNullOrEmpty(m) ? "form" : m.ToLowerInvariant();
        private static string Sep(string s) => string.IsNullOrEmpty(s) ? ":" : s;

        // ---- ActiveX 등록 (regasm 이 부른다) ------------------------------------

        [ComRegisterFunction]
        private static void Register(Type t)
        {
            using (var k = Registry.ClassesRoot.OpenSubKey(@"CLSID\" + t.GUID.ToString("B"), true))
            {
                k.CreateSubKey("Control").Close();
                using (var misc = k.CreateSubKey("MiscStatus")) misc.SetValue("", "131457");
                using (var tlb = k.CreateSubKey("TypeLib")) tlb.SetValue("", Marshal.GetTypeLibGuidForAssembly(t.Assembly).ToString("B"));
                var v = t.Assembly.GetName().Version;
                using (var ver = k.CreateSubKey("Version")) ver.SetValue("", v.Major + "." + v.Minor);
            }
        }

        [ComUnregisterFunction]
        private static void Unregister(Type t)
        {
            Registry.ClassesRoot.DeleteSubKeyTree(@"CLSID\" + t.GUID.ToString("B"), false);
        }
    }
}
