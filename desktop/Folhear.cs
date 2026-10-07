// Folhear para Windows: serve o app embutido em http://localhost e abre uma janela de aplicativo (Edge/Chrome).
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Reflection;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle("Folhear")]
[assembly: AssemblyProduct("Folhear")]
[assembly: AssemblyVersion("1.0.1.0")]

static class Program
{
    const int Port = 47851;

    static readonly Dictionary<string, string> Mime = new Dictionary<string, string> {
        { ".html", "text/html; charset=utf-8" }, { ".css", "text/css; charset=utf-8" }, { ".js", "text/javascript; charset=utf-8" },
        { ".svg", "image/svg+xml" }, { ".png", "image/png" }, { ".ico", "image/x-icon" }, { ".webmanifest", "application/manifest+json" },
        { ".woff2", "font/woff2" }
    };

    static string DataDir { get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Folhear"); } }

    [STAThread]
    static int Main(string[] args)
    {
        string url = "http://localhost:" + Port + "/";
        bool serveOnly = Array.IndexOf(args, "--serve") >= 0;

        // Se a porta já estiver em uso, outra janela do Folhear já está servindo o app.
        HttpListener listener = new HttpListener();
        listener.Prefixes.Add(url);
        bool owner = true;
        try { listener.Start(); } catch (HttpListenerException) { owner = false; }
        if (owner)
        {
            Thread t = new Thread(delegate() { Serve(listener); });
            t.IsBackground = true;
            t.Start();
        }
        if (serveOnly)
        {
            if (!owner) return 1;
            Thread.Sleep(Timeout.Infinite);
        }

        string browser = FindBrowser();
        if (browser == null)
        {
            Process.Start(url);
            if (owner) MessageBox.Show("O Folhear foi aberto no seu navegador.\nMantenha esta janela aberta enquanto usa; clique em OK para encerrar.", "Folhear");
            return 0;
        }

        string profile = Path.Combine(DataDir, "profile");
        Directory.CreateDirectory(profile);
        ProcessStartInfo psi = new ProcessStartInfo(browser,
            "--app=" + url + " --user-data-dir=\"" + profile + "\" --no-first-run --no-default-browser-check --disable-background-mode --ignore-gpu-blocklist --enable-unsafe-swiftshader --window-size=1400,900");
        psi.UseShellExecute = false;
        using (Process p = Process.Start(psi))
        {
            if (owner) p.WaitForExit();
        }
        return 0;
    }

    static void Serve(HttpListener listener)
    {
        while (listener.IsListening)
        {
            HttpListenerContext ctx;
            try { ctx = listener.GetContext(); } catch { break; }
            ThreadPool.QueueUserWorkItem(delegate { Handle(ctx); });
        }
    }

    static void Handle(HttpListenerContext ctx)
    {
        try
        {
            string path = Uri.UnescapeDataString(ctx.Request.Url.AbsolutePath).TrimStart('/');
            if (path.Length == 0) path = "index.html";
            if (path.StartsWith("api/")) { Api(ctx, path.Substring(4)); return; }
            Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream("app/" + path);
            if (s == null)
            {
                ctx.Response.StatusCode = 404;
                ctx.Response.Close();
                return;
            }
            using (s)
            {
                string mime;
                if (!Mime.TryGetValue(Path.GetExtension(path).ToLowerInvariant(), out mime)) mime = "application/octet-stream";
                ctx.Response.ContentType = mime;
                ctx.Response.ContentLength64 = s.Length;
                ctx.Response.AddHeader("Cache-Control", "no-cache");
                s.CopyTo(ctx.Response.OutputStream);
            }
            ctx.Response.Close();
        }
        catch
        {
            try { ctx.Response.Abort(); } catch { }
        }
    }

    // ---------- Sincronização com uma pasta (Google Drive para computador) ----------

    static string ConfigFile { get { return Path.Combine(DataDir, "sync.txt"); } }

    // Cada conta do Google Drive para computador aparece como uma unidade própria (G:, H:, ...).
    static List<string> DetectDrives()
    {
        List<string> found = new List<string>();
        try
        {
            foreach (DriveInfo d in DriveInfo.GetDrives())
            {
                if (!d.IsReady) continue;
                foreach (string name in new string[] { "Meu Drive", "My Drive" })
                {
                    string p = Path.Combine(d.RootDirectory.FullName, name);
                    if (Directory.Exists(p)) { found.Add(Path.Combine(p, "Folhear")); break; }
                }
            }
        }
        catch { }
        return found;
    }

    static string DetectDrive()
    {
        List<string> all = DetectDrives();
        return all.Count > 0 ? all[0] : null;
    }

    // Sem configuração: usa o Google Drive se ele existir. "off": desativado. Qualquer outro texto: pasta escolhida.
    static string SyncFolder()
    {
        string cfg = File.Exists(ConfigFile) ? File.ReadAllText(ConfigFile).Trim() : "";
        if (cfg == "off") return null;
        return cfg.Length > 0 ? cfg : DetectDrive();
    }

    static string Json(string s)
    {
        return s == null ? "null" : "\"" + s.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";
    }

    static void Reply(HttpListenerContext ctx, int status, string mime, byte[] body)
    {
        ctx.Response.StatusCode = status;
        ctx.Response.ContentType = mime;
        ctx.Response.AddHeader("Cache-Control", "no-store");
        ctx.Response.ContentLength64 = body.Length;
        ctx.Response.OutputStream.Write(body, 0, body.Length);
        ctx.Response.Close();
    }

    static void ReplyInfo(HttpListenerContext ctx)
    {
        string folder = SyncFolder();
        List<string> drives = DetectDrives();
        string list = "";
        foreach (string d in drives) list += (list.Length > 0 ? "," : "") + Json(d);
        string json = "{\"enabled\":" + (folder != null ? "true" : "false") + ",\"folder\":" + Json(folder) + ",\"detected\":" + Json(drives.Count > 0 ? drives[0] : null) + ",\"drives\":[" + list + "]}";
        Reply(ctx, 200, "application/json; charset=utf-8", Encoding.UTF8.GetBytes(json));
    }

    // As janelas do Windows precisam de uma thread STA própria; o formulário invisível as mantém à frente do app.
    static string ChooseFolder()
    {
        string result = null;
        Thread t = new Thread(delegate()
        {
            using (Form owner = new Form())
            using (FolderBrowserDialog d = new FolderBrowserDialog())
            {
                owner.TopMost = true;
                d.Description = "Escolha a pasta onde o Folhear guarda a estante sincronizada (por exemplo, dentro do Google Drive).";
                if (d.ShowDialog(owner) == DialogResult.OK) result = d.SelectedPath;
            }
        });
        t.SetApartmentState(ApartmentState.STA);
        t.Start();
        t.Join();
        return result;
    }

    // Os arquivos dos livros ficam na subpasta "livros", um por livro, com o id do livro no nome.
    static readonly Regex BookId = new Regex("^[a-z0-9]{4,64}$");
    static readonly object FileLock = new object();

    static void BookFile(HttpListenerContext ctx, string folder, string id)
    {
        if (!BookId.IsMatch(id)) { Reply(ctx, 400, "text/plain", new byte[0]); return; }
        string dir = Path.Combine(folder, "livros"), file = Path.Combine(dir, id + ".bin");
        string method = ctx.Request.HttpMethod;
        if (method == "POST")
        {
            Directory.CreateDirectory(dir);
            Directory.CreateDirectory(DataDir);
            string tmp = Path.Combine(DataDir, "upload-" + id + ".tmp");
            using (FileStream fs = File.Create(tmp)) ctx.Request.InputStream.CopyTo(fs);
            lock (FileLock)
            {
                File.Copy(tmp, file, true);
                File.Delete(tmp);
            }
            Reply(ctx, 200, "text/plain", new byte[0]);
        }
        else if (method == "DELETE")
        {
            if (File.Exists(file)) File.Delete(file);
            Reply(ctx, 200, "text/plain", new byte[0]);
        }
        else if (File.Exists(file))
        {
            using (FileStream fs = File.OpenRead(file))
            {
                ctx.Response.ContentType = "application/octet-stream";
                ctx.Response.AddHeader("Cache-Control", "no-store");
                ctx.Response.ContentLength64 = fs.Length;
                fs.CopyTo(ctx.Response.OutputStream);
            }
            ctx.Response.Close();
        }
        else Reply(ctx, 204, "text/plain", new byte[0]);
    }

    static void Api(HttpListenerContext ctx, string route)
    {
        // Só a própria página do Folhear pode usar a API: o cabeçalho próprio impede chamadas vindas de outros sites.
        string origin = ctx.Request.Headers["Origin"];
        if (ctx.Request.Headers["X-Folhear"] != "1" || (origin != null && origin != "http://localhost:" + Port))
        {
            Reply(ctx, 403, "text/plain", new byte[0]);
            return;
        }
        bool post = ctx.Request.HttpMethod == "POST";
        if (route == "sync/info") { ReplyInfo(ctx); return; }
        string folder = SyncFolder();
        if (route.StartsWith("file/"))
        {
            if (folder == null) { Reply(ctx, 409, "text/plain", new byte[0]); return; }
            BookFile(ctx, folder, route.Substring(5));
            return;
        }
        byte[] body = new byte[0];
        if (post)
        {
            using (MemoryStream ms = new MemoryStream()) { ctx.Request.InputStream.CopyTo(ms); body = ms.ToArray(); }
        }
        if (route == "sync/config" && post)
        {
            string v = Encoding.UTF8.GetString(body).Trim();
            Directory.CreateDirectory(DataDir);
            File.WriteAllText(ConfigFile, v == "auto" ? "" : v);
            ReplyInfo(ctx);
            return;
        }
        if (route == "sync/choose" && post)
        {
            string chosen = ChooseFolder();
            if (chosen != null)
            {
                Directory.CreateDirectory(DataDir);
                File.WriteAllText(ConfigFile, chosen);
            }
            ReplyInfo(ctx);
            return;
        }
        if (route == "sync")
        {
            if (folder == null) { Reply(ctx, 409, "text/plain", new byte[0]); return; }
            string file = Path.Combine(folder, "folhear-sync.json");
            if (post)
            {
                Directory.CreateDirectory(folder);
                Directory.CreateDirectory(DataDir);
                string tmp = Path.Combine(DataDir, "sync.tmp");
                File.WriteAllBytes(tmp, body);
                File.Copy(tmp, file, true);
                File.Delete(tmp);
                Reply(ctx, 200, "text/plain", new byte[0]);
            }
            else if (File.Exists(file)) Reply(ctx, 200, "application/json; charset=utf-8", File.ReadAllBytes(file));
            else Reply(ctx, 204, "text/plain", new byte[0]);
            return;
        }
        // Lista os livros cujo arquivo já está na pasta.
        if (route == "files")
        {
            if (folder == null) { Reply(ctx, 409, "text/plain", new byte[0]); return; }
            string dir = Path.Combine(folder, "livros"), list = "";
            if (Directory.Exists(dir))
                foreach (string f in Directory.GetFiles(dir, "*.bin")) list += (list.Length > 0 ? "," : "") + Json(Path.GetFileNameWithoutExtension(f));
            Reply(ctx, 200, "application/json; charset=utf-8", Encoding.UTF8.GetBytes("[" + list + "]"));
            return;
        }
        Reply(ctx, 404, "text/plain", new byte[0]);
    }

    static string FindBrowser()
    {
        foreach (string exe in new string[] { "msedge.exe", "chrome.exe" })
        {
            foreach (RegistryKey root in new RegistryKey[] { Registry.LocalMachine, Registry.CurrentUser })
            {
                try
                {
                    using (RegistryKey k = root.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\" + exe))
                    {
                        string p = k == null ? null : k.GetValue(null) as string;
                        if (p != null && File.Exists(p)) return p;
                    }
                }
                catch { }
            }
        }
        string pf86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
        string pf = Environment.GetEnvironmentVariable("ProgramW6432") ?? pf86;
        foreach (string p in new string[] {
            Path.Combine(pf86, @"Microsoft\Edge\Application\msedge.exe"), Path.Combine(pf, @"Microsoft\Edge\Application\msedge.exe"),
            Path.Combine(pf, @"Google\Chrome\Application\chrome.exe"), Path.Combine(pf86, @"Google\Chrome\Application\chrome.exe") })
        {
            if (File.Exists(p)) return p;
        }
        return null;
    }
}
