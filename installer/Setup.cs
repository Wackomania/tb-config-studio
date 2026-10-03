// TB Config Studio Setup / Uninstall (one source, two programs).
//   TBConfigStudio-Setup.exe  carries the whole package as a resource (payload.zip) and installs it for the current Windows user.
//   uninstall.exe             the same source built without the payload (/define:UNINSTALL_ONLY); it removes what Setup installed.
// Built with the C# compiler that is part of Windows (csc.exe, C# 5): no third-party tool, no network access. Per user: it needs no
// administrator rights and writes only to the chosen folder, the current user's Start menu / Desktop, and HKCU\...\Uninstall.
//
//   Setup.exe                         wizard
//   Setup.exe /S [switches]           silent. Switches (not case sensitive, /NAME=value):
//      /DIR=<folder>      install folder (default %LOCALAPPDATA%\Programs\TB Config Studio)
//      /NODESKTOP /NOSTARTMENU /NOLAUNCH
//      /TESTID=<name>     suffix for the registry key and the shortcut names, so a test never touches a real install
//      /LOG=<file>        write the log there
//      /DRYRUN            print every step as PLAN: ... and change nothing
//      /UNINSTALL [/REMOVEDATA]   remove it (settings and backups are kept unless /REMOVEDATA)
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Windows.Forms;
using Microsoft.Win32;

static class Setup
{
    const string AppName = "TB Config Studio";
    const string KeyBase = "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\TBConfigStudio";
    static bool dry, silent, noDesktop, noStart, noLaunch, uninstall, removeData;
    static string dir, testId = "", logFile;
    static StringBuilder log = new StringBuilder();

    static void Say(string s)
    {
        string line = (dry ? "PLAN: " : "") + s;
        log.AppendLine(line);
        if (logFile != null) { try { File.AppendAllText(logFile, line + Environment.NewLine); } catch (Exception) { } }
        if (silent || dry) { try { Console.WriteLine(line); } catch (Exception) { } }
    }
    static string KeyName() { return testId.Length > 0 ? KeyBase + "-" + testId : KeyBase; }
    static string LinkName() { return testId.Length > 0 ? AppName + " (" + testId + ")" : AppName; }
    static string DataDir()
    {
        string d = Environment.GetEnvironmentVariable("TBS_DATA");
        if (!string.IsNullOrEmpty(d)) return d;
        return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "TBConfigStudio");
    }

    [STAThread]
    static int Main(string[] args)
    {
        dir = Path.Combine(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs"), AppName);
        bool fromTemp = false;
        foreach (string a0 in args)
        {
            string a = a0.Trim();
            string u = a.ToUpperInvariant();
            if (u == "/S") silent = true;
            else if (u == "/DRYRUN") dry = true;
            else if (u == "/NODESKTOP") noDesktop = true;
            else if (u == "/NOSTARTMENU") noStart = true;
            else if (u == "/NOLAUNCH") noLaunch = true;
            else if (u == "/UNINSTALL") uninstall = true;
            else if (u == "/REMOVEDATA") removeData = true;
            else if (u == "/FROMTEMP") fromTemp = true;
            else if (u.StartsWith("/DIR=")) dir = a.Substring(5).Trim('"');
            else if (u.StartsWith("/TESTID=")) testId = Regex.Replace(a.Substring(8), "[^A-Za-z0-9_-]", "");
            else if (u.StartsWith("/LOG=")) logFile = a.Substring(5).Trim('"');
        }
#if UNINSTALL_ONLY
        uninstall = true;
        if (args.Length == 0) { string reg = RegisteredDir(); if (reg != null) dir = reg; else dir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\'); }
        else { string reg = RegisteredDir(); if (!HasArg(args, "/DIR=") && reg != null) dir = reg; }
#endif
        try
        {
            if (uninstall)
            {
                if (!silent && !dry && !fromTemp)
                {
                    if (MessageBox.Show("Remove " + AppName + " from this PC?", AppName + " Uninstall", MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return 0;
                    removeData = MessageBox.Show("Also delete your settings and the backups of your config files? Choose No to keep them.", AppName + " Uninstall", MessageBoxButtons.YesNo, MessageBoxIcon.Question, MessageBoxDefaultButton.Button2) == DialogResult.Yes;
                }
                return DoUninstall(fromTemp);
            }
            if (silent || dry) return DoInstall();
#if UNINSTALL_ONLY
            return 0;
#else
            return Wizard.Run();
#endif
        }
        catch (Exception e)
        {
            Say("ERROR: " + e.Message);
            if (!silent && !dry) MessageBox.Show(e.Message, AppName + " Setup", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }
    static bool HasArg(string[] args, string prefix) { foreach (string a in args) if (a.ToUpperInvariant().StartsWith(prefix)) return true; return false; }

    internal static string RegisteredDir()
    {
        try { using (RegistryKey k = Registry.CurrentUser.OpenSubKey(KeyName())) { if (k != null) { object v = k.GetValue("InstallLocation"); if (v != null) return v.ToString(); } } }
        catch (Exception) { }
        return null;
    }

    // The install folder must be a normal local folder: not a drive root, not UNC, not a system folder.
    internal static string CheckDir(string d)
    {
        if (string.IsNullOrWhiteSpace(d)) throw new Exception("Choose an install folder.");
        if (d.StartsWith("\\\\") || d.StartsWith("//")) throw new Exception("Network paths are not supported. Choose a folder on this PC.");
        if (!Regex.IsMatch(d, "^[A-Za-z]:[\\\\/]")) throw new Exception("Use a full path that starts with a drive letter.");
        if (d.Substring(2).Contains(":")) throw new Exception("The path contains a colon after the drive letter.");
        string full = Path.GetFullPath(d).TrimEnd('\\');
        if (full.Length <= 3) throw new Exception("Do not install into the root of a drive.");
        string win = Environment.GetFolderPath(Environment.SpecialFolder.Windows).TrimEnd('\\');
        string pf = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles).TrimEnd('\\');
        if (full.Equals(win, StringComparison.OrdinalIgnoreCase) || full.StartsWith(win + "\\", StringComparison.OrdinalIgnoreCase)) throw new Exception("Do not install into the Windows folder.");
        if (full.StartsWith(pf, StringComparison.OrdinalIgnoreCase)) throw new Exception("Program Files needs administrator rights. Choose a folder in your own profile, for example under AppData\\Local\\Programs.");
        return full;
    }

    static string Sha(string file)
    {
        using (SHA256 s = SHA256.Create()) using (FileStream f = File.OpenRead(file)) { StringBuilder sb = new StringBuilder(); foreach (byte b in s.ComputeHash(f)) sb.Append(b.ToString("x2")); return sb.ToString(); }
    }

    static void Shortcut(string lnk, string target, string workDir, string icon)
    {
        Type t = Type.GetTypeFromProgID("WScript.Shell");
        object sh = Activator.CreateInstance(t);
        object s = t.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, sh, new object[] { lnk });
        Type st = s.GetType();
        st.InvokeMember("TargetPath", BindingFlags.SetProperty, null, s, new object[] { target });
        st.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, s, new object[] { workDir });
        st.InvokeMember("IconLocation", BindingFlags.SetProperty, null, s, new object[] { icon });
        st.InvokeMember("Description", BindingFlags.SetProperty, null, s, new object[] { "Explain and edit the config files of the TheModBase DayZ mods (unofficial)" });
        st.InvokeMember("Save", BindingFlags.InvokeMethod, null, s, null);
    }
    static string StartLink() { return Path.Combine(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), AppName + (testId.Length > 0 ? " (" + testId + ")" : "")), LinkName() + ".lnk"); }
    static string DesktopLink() { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), LinkName() + ".lnk"); }

    // Own process only: the host of THIS installation (named in control.json of the data folder), never another program.
    static void StopRunningHost(string installDir)
    {
        try
        {
            string cf = Path.Combine(DataDir(), "control.json");
            if (!File.Exists(cf)) return;
            Match m = Regex.Match(File.ReadAllText(cf), "\"pid\"\\s*:\\s*(\\d+)");
            if (!m.Success) return;
            Process p = Process.GetProcessById(int.Parse(m.Groups[1].Value));
            string exe = ""; try { exe = p.MainModule.FileName; } catch (Exception) { }
            if (exe.StartsWith(installDir, StringComparison.OrdinalIgnoreCase)) { Say("stop the running app (process " + p.Id + ")"); if (!dry) { p.Kill(); p.WaitForExit(5000); } }
        }
        catch (Exception) { }
    }

    internal static int DoInstall()
    {
        string target = CheckDir(dir);
        Say("install folder " + target);
        Say("per-user install: no administrator rights, nothing outside the folder, Start menu, Desktop and HKCU");
        Stream payload = Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.zip");
        if (payload == null && !dry) throw new Exception("This setup program carries no payload.");
        if (Directory.Exists(target) && File.Exists(Path.Combine(target, "manifest.json"))) Say("an earlier installation was found and will be replaced (settings and backups in the data folder are kept)");
        else if (Directory.Exists(target) && Directory.GetFileSystemEntries(target).Length > 0) throw new Exception("The folder is not empty and does not hold an installation of this app. Choose an empty folder.");
        Say("extract the package, check the SHA-256 of every file against manifest.json");
        Say("write uninstall.exe and the uninstall entry for this Windows user (HKCU)");
        if (!noStart) Say("Start menu shortcut " + StartLink());
        if (!noDesktop) Say("Desktop shortcut " + DesktopLink());
        if (dry) { Say("nothing was written"); return 0; }

        StopRunningHost(target);
        // an earlier installation: remove its files first (data folder untouched)
        if (Directory.Exists(target) && File.Exists(Path.Combine(target, "manifest.json"))) RemoveFiles(target);
        Directory.CreateDirectory(target);
        string root = Path.GetFullPath(target) + "\\";
        List<string> written = new List<string>();
        using (ZipArchive z = new ZipArchive(payload, ZipArchiveMode.Read))
        {
            foreach (ZipArchiveEntry e in z.Entries)
            {
                if (e.FullName.EndsWith("/") || e.Name.Length == 0) continue;
                string dest = Path.GetFullPath(Path.Combine(target, e.FullName.Replace('/', '\\')));
                if (!dest.StartsWith(root, StringComparison.OrdinalIgnoreCase)) throw new Exception("The package is damaged (a file points outside the folder).");
                Directory.CreateDirectory(Path.GetDirectoryName(dest));
                e.ExtractToFile(dest, true);
                written.Add(dest);
            }
        }
        // verify
        string manifest = File.ReadAllText(Path.Combine(target, "manifest.json"));
        int checkedFiles = 0;
        foreach (Match m in Regex.Matches(manifest, "\"([^\"]+)\"\\s*:\\s*\"([0-9a-f]{64})\""))
        {
            string rel = m.Groups[1].Value.Replace('/', '\\');
            string f = Path.GetFullPath(Path.Combine(target, rel));
            if (!f.StartsWith(root, StringComparison.OrdinalIgnoreCase) || !File.Exists(f)) throw new Exception("The package is incomplete: " + rel);
            if (!Sha(f).Equals(m.Groups[2].Value, StringComparison.OrdinalIgnoreCase)) throw new Exception("The file " + rel + " does not match its checksum. The setup program may be damaged.");
            checkedFiles++;
        }
        Say("checked " + checkedFiles + " files");
        string exe = Path.Combine(target, "TBConfigStudio.exe");
        if (!noStart) { string l = StartLink(); Directory.CreateDirectory(Path.GetDirectoryName(l)); Shortcut(l, exe, target, exe + ",0"); Say("created " + l); }
        if (!noDesktop) { string l = DesktopLink(); Shortcut(l, exe, target, exe + ",0"); Say("created " + l); }
        string ver = "0"; Match vm = Regex.Match(manifest, "\"version\"\\s*:\\s*\"([^\"]+)\""); if (vm.Success) ver = vm.Groups[1].Value;
        long size = 0; foreach (string w in written) size += new FileInfo(w).Length;
        using (RegistryKey k = Registry.CurrentUser.CreateSubKey(KeyName()))
        {
            k.SetValue("DisplayName", AppName + (testId.Length > 0 ? " (" + testId + ")" : ""));
            k.SetValue("DisplayVersion", ver);
            k.SetValue("Publisher", "DayzHUB");
            k.SetValue("InstallLocation", target);
            k.SetValue("DisplayIcon", exe);
            k.SetValue("UninstallString", "\"" + Path.Combine(target, "uninstall.exe") + "\"" + (testId.Length > 0 ? " /TESTID=" + testId : ""));
            k.SetValue("QuietUninstallString", "\"" + Path.Combine(target, "uninstall.exe") + "\" /S /UNINSTALL" + (testId.Length > 0 ? " /TESTID=" + testId : ""));
            k.SetValue("NoModify", 1, RegistryValueKind.DWord);
            k.SetValue("NoRepair", 1, RegistryValueKind.DWord);
            k.SetValue("EstimatedSize", (int)(size / 1024), RegistryValueKind.DWord);
        }
        Say("installed " + AppName + " " + ver + " in " + target);
        if (!noLaunch && !silent) { try { Process.Start(new ProcessStartInfo(exe) { WorkingDirectory = target, UseShellExecute = false }); } catch (Exception) { } }
        return 0;
    }

    static void RemoveFiles(string target)
    {
        string root = Path.GetFullPath(target) + "\\";
        string mf = Path.Combine(target, "manifest.json");
        List<string> files = new List<string>();
        if (File.Exists(mf))
            foreach (Match m in Regex.Matches(File.ReadAllText(mf), "\"([^\"]+)\"\\s*:\\s*\"[0-9a-f]{64}\""))
            { string f = Path.GetFullPath(Path.Combine(target, m.Groups[1].Value.Replace('/', '\\'))); if (f.StartsWith(root, StringComparison.OrdinalIgnoreCase)) files.Add(f); }
        files.Add(mf);
        foreach (string f in files) { try { if (File.Exists(f)) { File.SetAttributes(f, FileAttributes.Normal); File.Delete(f); } } catch (Exception) { } }
        // empty folders (deepest first); anything the user added stays
        List<string> dirs = new List<string>(Directory.GetDirectories(target, "*", SearchOption.AllDirectories));
        dirs.Sort(delegate (string a, string b) { return b.Length.CompareTo(a.Length); });
        foreach (string d in dirs) { try { if (Directory.GetFileSystemEntries(d).Length == 0) Directory.Delete(d); } catch (Exception) { } }
    }

    internal static int DoUninstall(bool fromTemp)
    {
        string target;
        try { target = CheckDir(dir); } catch (Exception e) { throw new Exception("Cannot uninstall: " + e.Message); }
        Say("remove the installation in " + target);
        Say("remove the shortcuts, and the uninstall entry of this Windows user");
        Say(removeData ? "also delete settings and backups in " + DataDir() : "settings and backups in " + DataDir() + " are kept");
        if (dry) { Say("nothing was removed"); return 0; }
        string me = Assembly.GetExecutingAssembly().Location;
        // started from inside the install folder: run a copy from the temp folder so the folder (and this file) can be deleted
        if (!fromTemp && me.StartsWith(Path.GetFullPath(target), StringComparison.OrdinalIgnoreCase))
        {
            string tmp = Path.Combine(Path.GetTempPath(), "tbs-uninstall-" + Guid.NewGuid().ToString("N").Substring(0, 8) + ".exe");
            File.Copy(me, tmp, true);
            StringBuilder a = new StringBuilder("/UNINSTALL /FROMTEMP /DIR=\"" + target + "\"");
            if (silent) a.Append(" /S"); if (removeData) a.Append(" /REMOVEDATA"); if (testId.Length > 0) a.Append(" /TESTID=" + testId); if (logFile != null) a.Append(" /LOG=\"" + logFile + "\"");
            Process p = Process.Start(new ProcessStartInfo(tmp, a.ToString()) { UseShellExecute = false });
            if (silent) p.WaitForExit(120000);
            return silent ? p.ExitCode : 0;
        }
        StopRunningHost(target);
        if (!File.Exists(Path.Combine(target, "manifest.json")) && Directory.Exists(target) && Directory.GetFileSystemEntries(target).Length > 0)
            throw new Exception("That folder does not look like an installation of this app. Nothing was removed.");
        if (Directory.Exists(target)) RemoveFiles(target);
        string l1 = StartLink(), l2 = DesktopLink();
        try { if (File.Exists(l1)) File.Delete(l1); string d1 = Path.GetDirectoryName(l1); if (Directory.Exists(d1) && Directory.GetFileSystemEntries(d1).Length == 0) Directory.Delete(d1); } catch (Exception) { }
        try { if (File.Exists(l2)) File.Delete(l2); } catch (Exception) { }
        try { Registry.CurrentUser.DeleteSubKeyTree(KeyName(), false); } catch (Exception) { }
        if (removeData) { try { string dd = DataDir(); if (Directory.Exists(dd) && (File.Exists(Path.Combine(dd, "settings.json")) || Directory.Exists(Path.Combine(dd, "backups")))) Directory.Delete(dd, true); } catch (Exception) { } }
        // the install folder still holds this program when it was copied there: remove what is left after we exit
        try { if (Directory.Exists(target) && Directory.GetFileSystemEntries(target).Length == 0) Directory.Delete(target); } catch (Exception) { }
        if (fromTemp)
        {
            try { Process.Start(new ProcessStartInfo("cmd.exe", "/c ping 127.0.0.1 -n 3 >nul & del /f /q \"" + me + "\"") { CreateNoWindow = true, UseShellExecute = false }); } catch (Exception) { }
        }
        Say("removed " + AppName);
        if (!silent) MessageBox.Show(AppName + " was removed." + (removeData ? "" : " Your settings and backups were kept."), AppName, MessageBoxButtons.OK, MessageBoxIcon.Information);
        return 0;
    }

    // ---- settings used by the wizard
    internal static string Dir { get { return dir; } set { dir = value; } }
    internal static bool NoDesktop { get { return noDesktop; } set { noDesktop = value; } }
    internal static bool NoStart { get { return noStart; } set { noStart = value; } }
    internal static bool NoLaunch { get { return noLaunch; } set { noLaunch = value; } }
    internal static bool RemoveData { get { return removeData; } set { removeData = value; } }
    internal static bool Uninstalling { get { return uninstall; } }
    internal static string Name { get { return AppName; } }
}
