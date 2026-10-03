// The install wizard of TB Config Studio: one window, two pages (options, then done). Plain Windows Forms, no third-party code.
using System;
using System.Drawing;
using System.IO;
using System.Windows.Forms;

static class Wizard
{
    internal static int Run()
    {
        Application.EnableVisualStyles();
        Form f = new Form();
        f.Text = Setup.Name + " Setup";
        f.StartPosition = FormStartPosition.CenterScreen;
        f.FormBorderStyle = FormBorderStyle.FixedDialog;
        f.MaximizeBox = false;
        f.ClientSize = new Size(560, 330);
        f.Font = new Font("Segoe UI", 9f);
        try { f.Icon = Icon.ExtractAssociatedIcon(System.Reflection.Assembly.GetExecutingAssembly().Location); } catch (Exception) { }

        Label title = new Label(); title.Text = "Install " + Setup.Name; title.Font = new Font("Segoe UI", 14f, FontStyle.Bold); title.AutoSize = true; title.Location = new Point(20, 16);
        Label intro = new Label();
        intro.Text = "An unofficial offline tool that explains and edits the config files of the TheModBase DayZ mods. It makes no network connections.\r\nIt is installed for your Windows user only and needs no administrator rights.";
        intro.Location = new Point(20, 54); intro.Size = new Size(520, 50);
        Label dl = new Label(); dl.Text = "Install folder:"; dl.AutoSize = true; dl.Location = new Point(20, 118);
        TextBox tb = new TextBox(); tb.Text = Setup.Dir; tb.Location = new Point(20, 138); tb.Size = new Size(430, 24);
        Button browse = new Button(); browse.Text = "Browse..."; browse.Location = new Point(460, 136); browse.Size = new Size(80, 27);
        browse.Click += delegate
        {
            FolderBrowserDialog d = new FolderBrowserDialog();
            d.Description = "Choose the install folder";
            if (d.ShowDialog(f) == DialogResult.OK) tb.Text = Path.Combine(d.SelectedPath, Setup.Name);
        };
        CheckBox start = new CheckBox(); start.Text = "Add a Start menu shortcut"; start.Checked = true; start.AutoSize = true; start.Location = new Point(20, 178);
        CheckBox desk = new CheckBox(); desk.Text = "Add a Desktop shortcut"; desk.Checked = true; desk.AutoSize = true; desk.Location = new Point(20, 204);
        CheckBox launch = new CheckBox(); launch.Text = "Start " + Setup.Name + " when the installation is done"; launch.Checked = true; launch.AutoSize = true; launch.Location = new Point(20, 230);
        Label status = new Label(); status.Location = new Point(20, 262); status.Size = new Size(520, 20); status.ForeColor = Color.DarkRed;
        Button install = new Button(); install.Text = "Install"; install.Location = new Point(370, 288); install.Size = new Size(80, 28);
        Button cancel = new Button(); cancel.Text = "Cancel"; cancel.Location = new Point(460, 288); cancel.Size = new Size(80, 28);
        cancel.Click += delegate { f.Close(); };
        int rc = 1;
        install.Click += delegate
        {
            try
            {
                status.ForeColor = Color.Black; status.Text = "Installing...";
                install.Enabled = false; cancel.Enabled = false; f.Refresh();
                Setup.Dir = tb.Text; Setup.NoStart = !start.Checked; Setup.NoDesktop = !desk.Checked; Setup.NoLaunch = !launch.Checked;
                Setup.DoInstall();
                rc = 0;
                MessageBox.Show(Setup.Name + " is installed.", Setup.Name + " Setup", MessageBoxButtons.OK, MessageBoxIcon.Information);
                f.Close();
            }
            catch (Exception e)
            {
                status.ForeColor = Color.DarkRed; status.Text = e.Message.Length > 120 ? e.Message.Substring(0, 120) + "..." : e.Message;
                install.Enabled = true; cancel.Enabled = true;
                MessageBox.Show(e.Message, Setup.Name + " Setup", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        };
        f.AcceptButton = install; f.CancelButton = cancel;
        f.Controls.AddRange(new Control[] { title, intro, dl, tb, browse, start, desk, launch, status, install, cancel });
        Application.Run(f);
        return rc;
    }
}
