// TBConfigStudio.exe: the program behind the start-menu icon. It starts the app host (Node.js, bundled as runtime\node.exe) without a console
// window and exits; the host opens the app window itself (Microsoft Edge or Google Chrome in app mode) and ends when the window is closed.
// A second start while the host runs just opens another window on it. Built with the C# compiler that is part of Windows (C# 5, no packages).
//   TBConfigStudio.exe [--data <folder>] [--port <n>]
// A file named portable.txt next to this exe makes the app keep its data (settings, backups) in the "data" folder beside it.
using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Windows.Forms;

static class Program
{
    [STAThread]
    static int Main(string[] args)
    {
        string root = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
        string main = Path.Combine(root, "app", "src", "server", "main.js");
        string node = Path.Combine(Path.Combine(root, "runtime"), "node.exe");
        if (!File.Exists(main))
        {
            MessageBox.Show("The program files are incomplete (app\\src\\server\\main.js is missing). Run the installer again.", "TB Config Studio", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 2;
        }
        if (!File.Exists(node)) node = FindOnPath("node.exe");
        if (node == null)
        {
            MessageBox.Show("Node.js was not found. The installer includes it in the runtime folder, so the installation looks damaged. Run the installer again.", "TB Config Studio", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 2;
        }
        StringBuilder a = new StringBuilder();
        a.Append("\"").Append(main).Append("\"");
        bool hasData = false;
        for (int i = 0; i < args.Length; i++)
        {
            if (args[i] == "--data") hasData = true;
            a.Append(" \"").Append(args[i].Replace("\"", "")).Append("\"");
        }
        if (!hasData && File.Exists(Path.Combine(root, "portable.txt")))
            a.Append(" --data \"").Append(Path.Combine(root, "data")).Append("\"");
        ProcessStartInfo psi = new ProcessStartInfo(node, a.ToString());
        psi.WorkingDirectory = Path.Combine(root, "app");
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        Process p;
        try { p = Process.Start(psi); }
        catch (Exception e)
        {
            MessageBox.Show("The app could not be started: " + e.Message, "TB Config Studio", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 3;
        }
        // The host keeps running when the window is open. If it ends within a few seconds, something is wrong (or it was only a second start).
        if (p.WaitForExit(4000) && p.ExitCode != 0)
        {
            MessageBox.Show("The app stopped right after it started (code " + p.ExitCode + ")." + "\n\nDetails may be in app.log in the app's data folder.", "TB Config Studio", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 4;
        }
        return 0;
    }

    static string FindOnPath(string file)
    {
        string path = Environment.GetEnvironmentVariable("PATH");
        if (path == null) return null;
        foreach (string dir in path.Split(';'))
        {
            try
            {
                if (dir.Length == 0) continue;
                string c = Path.Combine(dir.Trim().Trim('"'), file);
                if (File.Exists(c)) return c;
            }
            catch (Exception) { }
        }
        return null;
    }
}
