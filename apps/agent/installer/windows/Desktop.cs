using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Windows.Forms;
[assembly: AssemblyTitle("NodeAccess Agent")]
[assembly: AssemblyDescription("NodeAccess Agent - configuracao e status")]
[assembly: AssemblyCompany("NodeAccess")]
[assembly: AssemblyProduct("NodeAccess Agent")]
class Desktop {
  [STAThread]
  static int Main(string[] args) {
    try {
      string script = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "AgentSetup.ps1");
      string ps = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), @"WindowsPowerShell\v1.0\powershell.exe");
      var start = new ProcessStartInfo(ps, "-NoProfile -STA -WindowStyle Hidden -ExecutionPolicy Bypass -File \"" + script + "\"" + (Array.IndexOf(args, "-Run") >= 0 ? " -Run" : ""));
      start.UseShellExecute = false;
      start.CreateNoWindow = true;
      using (var child = Process.Start(start)) { child.WaitForExit(); return child.ExitCode; }
    } catch (Exception) {
      MessageBox.Show("Nao foi possivel abrir o NodeAccess Agent. Repare a instalacao.", "NodeAccess Agent", MessageBoxButtons.OK, MessageBoxIcon.Error);
      return 1;
    }
  }
}
