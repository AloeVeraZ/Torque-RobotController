// The USB half of Calibrate's Axon programmer: raw HID to Axon's V2 programmer, which Node cannot reach without a native
// module. Built by tools/build-axon-usb.cjs with the C# compiler that ships with Windows. The HID code is Axon Bridge's
// (Hid.cs); everything the frames mean lives in src/axon-servo.cjs. It reads one request a line from stdin and writes one
// answer a line, "<id> ok [data]" or "<id> err <message>", and exits when stdin closes, so it cannot outlive the app.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using Microsoft.Win32.SafeHandles;

namespace TorqueAxonUsb
{
    public class DeviceLostException : Exception
    {
        public DeviceLostException(string message) : base(message) { }
    }

    public sealed class HidInfo
    {
        public string Path;
        public int Vid, Pid, Version, InLen, OutLen;
        public string Product = "", Maker = "", Serial = "";
    }

    internal static class Native
    {
        public const uint GENERIC_READ = 0x80000000, GENERIC_WRITE = 0x40000000;
        public const uint FILE_SHARE_READ = 1, FILE_SHARE_WRITE = 2, OPEN_EXISTING = 3, FILE_FLAG_OVERLAPPED = 0x40000000;
        public const int DIGCF_PRESENT = 2, DIGCF_DEVICEINTERFACE = 0x10;
        public const int ERROR_IO_PENDING = 997;
        public const uint WAIT_OBJECT_0 = 0;

        [StructLayout(LayoutKind.Sequential)]
        public struct SP_DEVICE_INTERFACE_DATA
        {
            public int cbSize;
            public Guid InterfaceClassGuid;
            public int Flags;
            public IntPtr Reserved;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct HIDD_ATTRIBUTES
        {
            public int Size;
            public ushort VendorID, ProductID, VersionNumber;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct HIDP_CAPS
        {
            public ushort Usage, UsagePage, InputReportByteLength, OutputReportByteLength, FeatureReportByteLength;
            [MarshalAs(UnmanagedType.ByValArray, SizeConst = 17)]
            public ushort[] Reserved;
            public ushort NumberLinkCollectionNodes, NumberInputButtonCaps, NumberInputValueCaps, NumberInputDataIndices,
                NumberOutputButtonCaps, NumberOutputValueCaps, NumberOutputDataIndices,
                NumberFeatureButtonCaps, NumberFeatureValueCaps, NumberFeatureDataIndices;
        }

        [DllImport("hid.dll")] public static extern void HidD_GetHidGuid(out Guid guid);
        [DllImport("hid.dll", SetLastError = true)] public static extern bool HidD_GetAttributes(SafeFileHandle h, ref HIDD_ATTRIBUTES a);
        [DllImport("hid.dll", SetLastError = true)] public static extern bool HidD_GetPreparsedData(SafeFileHandle h, out IntPtr data);
        [DllImport("hid.dll", SetLastError = true)] public static extern bool HidD_FreePreparsedData(IntPtr data);
        [DllImport("hid.dll", SetLastError = true)] public static extern int HidP_GetCaps(IntPtr data, ref HIDP_CAPS caps);
        [DllImport("hid.dll", SetLastError = true)] public static extern bool HidD_FlushQueue(SafeFileHandle h);
        [DllImport("hid.dll", SetLastError = true)] public static extern bool HidD_GetProductString(SafeFileHandle h, byte[] buf, int len);
        [DllImport("hid.dll", SetLastError = true)] public static extern bool HidD_GetManufacturerString(SafeFileHandle h, byte[] buf, int len);
        [DllImport("hid.dll", SetLastError = true)] public static extern bool HidD_GetSerialNumberString(SafeFileHandle h, byte[] buf, int len);

        [DllImport("setupapi.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        public static extern IntPtr SetupDiGetClassDevs(ref Guid guid, IntPtr enumerator, IntPtr parent, int flags);
        [DllImport("setupapi.dll", SetLastError = true)]
        public static extern bool SetupDiDestroyDeviceInfoList(IntPtr set);
        [DllImport("setupapi.dll", SetLastError = true)]
        public static extern bool SetupDiEnumDeviceInterfaces(IntPtr set, IntPtr info, ref Guid guid, uint index, ref SP_DEVICE_INTERFACE_DATA data);
        [DllImport("setupapi.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        public static extern bool SetupDiGetDeviceInterfaceDetail(IntPtr set, ref SP_DEVICE_INTERFACE_DATA data, IntPtr detail, uint size, out uint needed, IntPtr info);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        public static extern SafeFileHandle CreateFile(string path, uint access, uint share, IntPtr sec, uint disposition, uint flags, IntPtr template);
        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern bool ReadFile(SafeFileHandle h, IntPtr buf, uint len, out uint read, IntPtr overlapped);
        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern bool WriteFile(SafeFileHandle h, IntPtr buf, uint len, out uint written, IntPtr overlapped);
        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern bool GetOverlappedResult(SafeFileHandle h, IntPtr overlapped, out uint done, bool wait);
        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern bool CancelIoEx(SafeFileHandle h, IntPtr overlapped);
        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern IntPtr CreateEvent(IntPtr sec, bool manualReset, bool initial, string name);
        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern bool ResetEvent(IntPtr ev);
        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern uint WaitForSingleObject(IntPtr h, int ms);
        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern bool CloseHandle(IntPtr h);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        public static extern IntPtr FindWindow(string cls, string title);
    }

    public static class HidEnum
    {
        public static List<HidInfo> Find(int vid, int pid)
        {
            var found = new List<HidInfo>();
            string tag = string.Format("vid_{0:x4}&pid_{1:x4}", vid, pid);
            Guid g;
            Native.HidD_GetHidGuid(out g);
            IntPtr set = Native.SetupDiGetClassDevs(ref g, IntPtr.Zero, IntPtr.Zero, Native.DIGCF_PRESENT | Native.DIGCF_DEVICEINTERFACE);
            if (set == new IntPtr(-1)) return found;
            try
            {
                for (uint i = 0; ; i++)
                {
                    var data = new Native.SP_DEVICE_INTERFACE_DATA();
                    data.cbSize = Marshal.SizeOf(data);
                    if (!Native.SetupDiEnumDeviceInterfaces(set, IntPtr.Zero, ref g, i, ref data)) break;
                    uint need;
                    Native.SetupDiGetDeviceInterfaceDetail(set, ref data, IntPtr.Zero, 0, out need, IntPtr.Zero);
                    if (need == 0) continue;
                    IntPtr buf = Marshal.AllocHGlobal((int)need);
                    try
                    {
                        Marshal.WriteInt32(buf, IntPtr.Size == 8 ? 8 : 6);
                        if (!Native.SetupDiGetDeviceInterfaceDetail(set, ref data, buf, need, out need, IntPtr.Zero)) continue;
                        string path = Marshal.PtrToStringUni(new IntPtr(buf.ToInt64() + 4));
                        if (path == null || path.ToLowerInvariant().IndexOf(tag, StringComparison.Ordinal) < 0) continue;
                        HidInfo info = Describe(path);
                        if (info != null) found.Add(info);
                    }
                    finally { Marshal.FreeHGlobal(buf); }
                }
            }
            finally { Native.SetupDiDestroyDeviceInfoList(set); }
            found.Sort((a, b) => b.OutLen.CompareTo(a.OutLen));
            return found;
        }

        static HidInfo Describe(string path)
        {
            using (SafeFileHandle h = Native.CreateFile(path, 0, Native.FILE_SHARE_READ | Native.FILE_SHARE_WRITE, IntPtr.Zero, Native.OPEN_EXISTING, 0, IntPtr.Zero))
            {
                if (h.IsInvalid) return null;
                var a = new Native.HIDD_ATTRIBUTES();
                a.Size = Marshal.SizeOf(a);
                if (!Native.HidD_GetAttributes(h, ref a)) return null;
                var info = new HidInfo { Path = path, Vid = a.VendorID, Pid = a.ProductID, Version = a.VersionNumber };
                IntPtr pre;
                if (Native.HidD_GetPreparsedData(h, out pre))
                {
                    var caps = new Native.HIDP_CAPS();
                    Native.HidP_GetCaps(pre, ref caps);
                    info.InLen = caps.InputReportByteLength;
                    info.OutLen = caps.OutputReportByteLength;
                    Native.HidD_FreePreparsedData(pre);
                }
                var s = new byte[254];
                if (Native.HidD_GetProductString(h, s, s.Length)) info.Product = Text(s);
                s = new byte[254];
                if (Native.HidD_GetManufacturerString(h, s, s.Length)) info.Maker = Text(s);
                s = new byte[254];
                if (Native.HidD_GetSerialNumberString(h, s, s.Length)) info.Serial = Text(s);
                return info;
            }
        }

        static string Text(byte[] utf16)
        {
            return Encoding.Unicode.GetString(utf16).TrimEnd('\0');
        }
    }

    /// <summary>Overlapped HID I/O so a silent device can never hang.</summary>
    public sealed class HidPort : IDisposable
    {
        readonly SafeFileHandle handle;
        readonly int inLen, outLen;
        readonly IntPtr rBuf, wBuf, rOv, wOv, rEv, wEv;
        bool disposed;

        public HidPort(HidInfo info)
        {
            inLen = info.InLen > 0 ? info.InLen : 64;
            outLen = info.OutLen > 0 ? info.OutLen : 64;
            handle = Native.CreateFile(info.Path, Native.GENERIC_READ | Native.GENERIC_WRITE, Native.FILE_SHARE_READ | Native.FILE_SHARE_WRITE,
                IntPtr.Zero, Native.OPEN_EXISTING, Native.FILE_FLAG_OVERLAPPED, IntPtr.Zero);
            if (handle.IsInvalid) throw new DeviceLostException("Could not open the programmer (Windows error " + Marshal.GetLastWin32Error() + ").");
            rBuf = Marshal.AllocHGlobal(inLen);
            wBuf = Marshal.AllocHGlobal(outLen);
            int ovSize = Marshal.SizeOf(typeof(NativeOverlapped));
            rOv = Marshal.AllocHGlobal(ovSize);
            wOv = Marshal.AllocHGlobal(ovSize);
            rEv = Native.CreateEvent(IntPtr.Zero, true, false, null);
            wEv = Native.CreateEvent(IntPtr.Zero, true, false, null);
        }

        static void Arm(IntPtr ov, IntPtr ev)
        {
            var o = new NativeOverlapped();
            o.EventHandle = ev;
            Marshal.StructureToPtr(o, ov, false);
            Native.ResetEvent(ev);
        }

        public bool Write(byte[] report, int timeoutMs)
        {
            var full = new byte[outLen];
            Buffer.BlockCopy(report, 0, full, 0, Math.Min(report.Length, outLen));
            Marshal.Copy(full, 0, wBuf, outLen);
            Arm(wOv, wEv);
            uint done;
            if (!Native.WriteFile(handle, wBuf, (uint)outLen, out done, wOv))
            {
                int e = Marshal.GetLastWin32Error();
                if (e != Native.ERROR_IO_PENDING) throw new DeviceLostException("USB write failed (error " + e + ").");
                if (Native.WaitForSingleObject(wEv, timeoutMs) != Native.WAIT_OBJECT_0)
                {
                    Native.CancelIoEx(handle, wOv);
                    Native.GetOverlappedResult(handle, wOv, out done, true);
                    return false;
                }
                if (!Native.GetOverlappedResult(handle, wOv, out done, false))
                    throw new DeviceLostException("USB write failed (error " + Marshal.GetLastWin32Error() + ").");
            }
            return true;
        }

        public byte[] Read(int timeoutMs)
        {
            Arm(rOv, rEv);
            uint got;
            if (!Native.ReadFile(handle, rBuf, (uint)inLen, out got, rOv))
            {
                int e = Marshal.GetLastWin32Error();
                if (e != Native.ERROR_IO_PENDING) throw new DeviceLostException("USB read failed (error " + e + ").");
                if (Native.WaitForSingleObject(rEv, timeoutMs) != Native.WAIT_OBJECT_0)
                {
                    Native.CancelIoEx(handle, rOv);
                    // A report may have landed at the same moment the wait expired; do not lose it.
                    if (!Native.GetOverlappedResult(handle, rOv, out got, true) || got == 0) return null;
                }
                else if (!Native.GetOverlappedResult(handle, rOv, out got, false))
                {
                    throw new DeviceLostException("USB read failed (error " + Marshal.GetLastWin32Error() + ").");
                }
            }
            var data = new byte[Math.Max((int)got, 64)];
            Marshal.Copy(rBuf, data, 0, (int)got);
            return data;
        }

        public void Flush()
        {
            Native.HidD_FlushQueue(handle);
        }

        public void Dispose()
        {
            if (disposed) return;
            disposed = true;
            handle.Dispose();
            Native.CloseHandle(rEv);
            Native.CloseHandle(wEv);
            Marshal.FreeHGlobal(rBuf);
            Marshal.FreeHGlobal(wBuf);
            Marshal.FreeHGlobal(rOv);
            Marshal.FreeHGlobal(wOv);
        }
    }

    internal static class Program
    {
        // The two apps that poll the same programmer: two on one device corrupt each other's traffic.
        static readonly string[] Rivals = { "Axon Software MK2", "Axon Bridge", "Program Software" };
        static HidPort port;

        static string Quote(string s)
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

        static string Json(HidInfo i)
        {
            return string.Format("{{\"path\":{0},\"vid\":{1},\"pid\":{2},\"version\":{3},\"inLen\":{4},\"outLen\":{5},\"product\":{6},\"maker\":{7},\"serial\":{8}}}",
                Quote(i.Path), i.Vid, i.Pid, i.Version, i.InLen, i.OutLen, Quote(i.Product), Quote(i.Maker), Quote(i.Serial));
        }

        static string Hex(byte[] data)
        {
            var b = new StringBuilder(data.Length * 2);
            foreach (byte x in data) b.Append(x.ToString("x2"));
            return b.ToString();
        }

        static byte[] Bytes(string hex)
        {
            var r = new byte[hex.Length / 2];
            for (int i = 0; i < r.Length; i++) r[i] = Convert.ToByte(hex.Substring(i * 2, 2), 16);
            return r;
        }

        static HidPort Open()
        {
            if (port == null) throw new DeviceLostException("The programmer is not open.");
            return port;
        }

        static void CloseOpen()
        {
            if (port != null) port.Dispose();
            port = null;
        }

        static string Handle(string command, string[] a)
        {
            switch (command)
            {
                case "ping":
                    return "pong";
                case "find":
                    {
                        var parts = new List<string>();
                        foreach (HidInfo i in HidEnum.Find(Convert.ToInt32(a[0], 16), Convert.ToInt32(a[1], 16))) parts.Add(Json(i));
                        return "[" + string.Join(",", parts) + "]";
                    }
                case "open":
                    {
                        CloseOpen();
                        foreach (HidInfo i in HidEnum.Find(Convert.ToInt32(a[0], 16), Convert.ToInt32(a[1], 16)))
                            if (i.Path == a[2])
                            {
                                port = new HidPort(i);
                                return "";
                            }
                        throw new DeviceLostException("The programmer is gone.");
                    }
                case "close":
                    CloseOpen();
                    return "";
                case "write":
                    return Open().Write(Bytes(a[1]), int.Parse(a[0])) ? "1" : "0";
                case "read":
                    {
                        byte[] r = Open().Read(int.Parse(a[0]));
                        return r == null ? "" : Hex(r);
                    }
                case "flush":
                    Open().Flush();
                    return "";
                case "rivals":
                    {
                        var open = new List<string>();
                        foreach (string title in Rivals)
                            if (Native.FindWindow(null, title) != IntPtr.Zero) open.Add(Quote(title));
                        return "[" + string.Join(",", open) + "]";
                    }
                case "close-rivals":
                    foreach (Process p in Process.GetProcesses())
                    {
                        try { if (Array.IndexOf(Rivals, p.MainWindowTitle) >= 0) p.CloseMainWindow(); }
                        catch (Exception) { }
                        finally { p.Dispose(); }
                    }
                    return "";
                default:
                    throw new InvalidOperationException("Unknown request " + command + ".");
            }
        }

        static int Main()
        {
            Console.Out.Flush();
            var input = Console.In;
            var output = new System.IO.StreamWriter(Console.OpenStandardOutput(), new ASCIIEncoding()) { AutoFlush = true, NewLine = "\n" };
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
                catch (Exception e) { output.WriteLine(parts[0] + " err " + e.Message); }
            }
            CloseOpen();
            return 0;
        }
    }
}
