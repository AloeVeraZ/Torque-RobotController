// The serial half of the SWYFT Programmer tab: SWYFT's servo programmer is a CP2102 USB-to-UART adapter (a COM port), which
// Node cannot open without a native module. Built by tools/build-swyft-serial.cjs with the C# compiler that ships with Windows.
// Everything the bytes mean lives in src/swyft-servo.cjs. It reads one request a line from stdin and writes one answer a line,
// "<id> ok [data]", "<id> lost <message>" (the port went away) or "<id> err <message>", and exits when stdin closes, so it
// cannot outlive the app. Same line protocol as src/axon-usb/AxonUsb.cs.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Ports;
using System.Text;
using System.Threading;
using Microsoft.Win32;

namespace TorqueSwyftSerial
{
    public class DeviceLostException : Exception
    {
        public DeviceLostException(string message) : base(message) { }
    }

    public static class Program
    {
        static SerialPort port;
        static readonly string[] Rivals = { "SwyftServoProgrammerV2" };

        static string Json(string s)
        {
            var b = new StringBuilder("\"");
            foreach (char c in s ?? "")
            {
                if (c == '"' || c == '\\') b.Append('\\').Append(c);
                else if (c < 32 || c > 126) b.AppendFormat("\\u{0:x4}", (int)c);
                else b.Append(c);
            }
            return b.Append('"').ToString();
        }

        static string Hex(byte[] data, int count)
        {
            var b = new StringBuilder(count * 2);
            for (int i = 0; i < count; i++) b.Append(data[i].ToString("x2"));
            return b.ToString();
        }

        static byte[] Bytes(string hex)
        {
            var data = new byte[hex.Length / 2];
            for (int i = 0; i < data.Length; i++) data[i] = Convert.ToByte(hex.Substring(i * 2, 2), 16);
            return data;
        }

        // USB serial ports present now, with their USB IDs, from the device registry. Ports that are not USB (a laptop's built-in
        // Intel AMT port, Bluetooth links) are left out: those are what SWYFT's own app sometimes connects to by mistake.
        static string Ports()
        {
            var present = new HashSet<string>(SerialPort.GetPortNames(), StringComparer.OrdinalIgnoreCase);
            var found = new List<string>();
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (string bus in new[] { "USB", "FTDIBUS" })
            {
                using (RegistryKey root = Registry.LocalMachine.OpenSubKey(@"SYSTEM\CurrentControlSet\Enum\" + bus))
                {
                    if (root == null) continue;
                    foreach (string ids in root.GetSubKeyNames())
                    {
                        int vid = Id(ids, "VID_"), pid = Id(ids, "PID_");
                        if (vid < 0 || pid < 0) continue;
                        using (RegistryKey device = root.OpenSubKey(ids))
                        {
                            if (device == null) continue;
                            foreach (string instance in device.GetSubKeyNames())
                            {
                                using (RegistryKey one = device.OpenSubKey(instance))
                                using (RegistryKey parameters = one == null ? null : one.OpenSubKey("Device Parameters"))
                                {
                                    string name = parameters == null ? null : parameters.GetValue("PortName") as string;
                                    if (string.IsNullOrEmpty(name) || !present.Contains(name) || !seen.Add(name)) continue;
                                    string friendly = (one.GetValue("FriendlyName") as string) ?? (one.GetValue("DeviceDesc") as string) ?? "";
                                    int semi = friendly.LastIndexOf(';');
                                    if (semi >= 0) friendly = friendly.Substring(semi + 1);
                                    found.Add("{\"port\":" + Json(name) + ",\"vid\":" + vid + ",\"pid\":" + pid + ",\"name\":" + Json(friendly) +
                                        ",\"serial\":" + Json(bus == "USB" ? instance : "") + "}");
                                }
                            }
                        }
                    }
                }
            }
            return "[" + string.Join(",", found) + "]";
        }

        // "VID_10C4&PID_EA60" or FTDI's "VID_0403+PID_6001+...": the four hex digits after the tag, or -1.
        static int Id(string text, string tag)
        {
            int at = text.IndexOf(tag, StringComparison.OrdinalIgnoreCase);
            if (at < 0 || at + tag.Length + 4 > text.Length) return -1;
            int value;
            return int.TryParse(text.Substring(at + tag.Length, 4), System.Globalization.NumberStyles.HexNumber, null, out value) ? value : -1;
        }

        static string RivalList()
        {
            var names = new List<string>();
            foreach (string rival in Rivals)
                foreach (Process p in Process.GetProcessesByName(rival)) { names.Add(Json(rival)); p.Dispose(); break; }
            return "[" + string.Join(",", names) + "]";
        }

        static void CloseRivals()
        {
            foreach (string rival in Rivals)
                foreach (Process p in Process.GetProcessesByName(rival))
                {
                    try { p.CloseMainWindow(); if (!p.WaitForExit(3000)) p.Kill(); } catch { }
                    p.Dispose();
                }
        }

        static void Open(string name, int baud)
        {
            CloseOpen();
            // 8 data bits, no parity, 2 stop bits, no handshake, DTR and RTS left low: what SWYFT's app opens the port with.
            var p = new SerialPort(name, baud, Parity.None, 8, StopBits.Two) { Handshake = Handshake.None, ReadTimeout = 50, WriteTimeout = 1000 };
            try { p.Open(); }
            catch (UnauthorizedAccessException) { p.Dispose(); throw new Exception("busy " + name + " is open in another program."); }
            p.DiscardInBuffer();
            p.DiscardOutBuffer();
            port = p;
        }

        static void CloseOpen()
        {
            var p = port;
            port = null;
            if (p == null) return;
            try { p.Close(); } catch { }
            p.Dispose();
        }

        static SerialPort Live()
        {
            if (port == null || !port.IsOpen) throw new DeviceLostException("The programmer is not open.");
            return port;
        }

        // Waits up to timeoutMs for bytes, then a little longer for the rest of what is arriving, and returns all of it (hex),
        // or nothing on a timeout.
        static string Read(int timeoutMs)
        {
            var p = Live();
            var clock = Stopwatch.StartNew();
            try
            {
                while (p.BytesToRead == 0 && clock.ElapsedMilliseconds < timeoutMs) Thread.Sleep(2);
                if (p.BytesToRead == 0) return "";
                int last = -1;
                while (p.BytesToRead != last) { last = p.BytesToRead; Thread.Sleep(3); }
                var data = new byte[p.BytesToRead];
                int n = p.Read(data, 0, data.Length);
                return Hex(data, n);
            }
            catch (IOException e) { throw new DeviceLostException(e.Message); }
            catch (InvalidOperationException e) { throw new DeviceLostException(e.Message); }
        }

        static void Write(string hex)
        {
            var p = Live();
            var data = Bytes(hex);
            try { p.Write(data, 0, data.Length); }
            catch (IOException e) { throw new DeviceLostException(e.Message); }
            catch (InvalidOperationException e) { throw new DeviceLostException(e.Message); }
        }

        static void Flush()
        {
            var p = Live();
            try { p.DiscardInBuffer(); }
            catch (IOException e) { throw new DeviceLostException(e.Message); }
            catch (InvalidOperationException e) { throw new DeviceLostException(e.Message); }
        }

        static string Handle(string command, string[] args)
        {
            switch (command)
            {
                case "ping": return "";
                case "ports": return Ports();
                case "open": Open(args[0], int.Parse(args[1])); return "";
                case "close": CloseOpen(); return "";
                case "write": Write(args[0]); return "";
                case "read": return Read(int.Parse(args[0]));
                case "flush": Flush(); return "";
                case "rivals": return RivalList();
                case "close-rivals": CloseRivals(); return "";
                default: throw new Exception("Unknown command " + command + ".");
            }
        }

        static int Main()
        {
            var input = Console.In;
            var output = new StreamWriter(Console.OpenStandardOutput(), new ASCIIEncoding()) { AutoFlush = true, NewLine = "\n" };
            string line;
            while ((line = input.ReadLine()) != null)
            {
                string[] parts = line.Split(' ');
                if (parts.Length < 2) continue;
                var args = new string[parts.Length - 2];
                Array.Copy(parts, 2, args, 0, args.Length);
                try
                {
                    string answer = Handle(parts[1], args);
                    output.WriteLine(parts[0] + " ok" + (answer.Length > 0 ? " " + answer : ""));
                }
                catch (DeviceLostException e) { output.WriteLine(parts[0] + " lost " + e.Message); }
                catch (Exception e) { output.WriteLine(parts[0] + " err " + e.Message.Replace('\n', ' ').Replace('\r', ' ')); }
            }
            CloseOpen();
            return 0;
        }
    }
}
