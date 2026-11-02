// The first layer of Setup and Calibrate's Control Hub watch: Windows says the moment a USB device arrives or leaves, sooner than
// ADB can. Built by tools/build-usb-watch.cjs with the C# compiler that ships with Windows; src/usb-watch.cjs reads what it says.
// It waits on a hidden message-only window, so it uses no CPU until something changes. It writes one line each:
//   "= <ms> <path><TAB><name>" for every USB device present, then "ready <ms>", at the start and again whenever stdin says "list"
//   "+ <ms> <path><TAB><name>" as one arrives, and "- <ms> <path>" as one leaves
//   "err <message>" and it exits, if it cannot watch
// <path> is Windows's own name for the device, \\?\USB#VID_2207&PID_0011#<serial>#{...}, <name> what the device calls itself ("Control
// Hub v1.0"), which tells a Driver Hub starting up from a Control Hub, and <ms> the time in Unix milliseconds.
// It exits when stdin closes, so it cannot outlive the app.
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace TorqueUsbWatch
{
    internal static class Native
    {
        public const uint WM_DEVICECHANGE = 0x0219, WM_APP = 0x8000;
        public const int DBT_DEVICEARRIVAL = 0x8000, DBT_DEVICEREMOVECOMPLETE = 0x8004, DBT_DEVTYP_DEVICEINTERFACE = 5;
        public const int DIGCF_PRESENT = 2, DIGCF_DEVICEINTERFACE = 0x10;
        public static readonly IntPtr HWND_MESSAGE = new IntPtr(-3);

        public delegate IntPtr WndProc(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam);

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        public struct WNDCLASS
        {
            public uint style;
            public WndProc lpfnWndProc;
            public int cbClsExtra, cbWndExtra;
            public IntPtr hInstance, hIcon, hCursor, hbrBackground;
            public string lpszMenuName, lpszClassName;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct MSG
        {
            public IntPtr hwnd;
            public uint message;
            public IntPtr wParam, lParam;
            public uint time;
            public int x, y;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct DEV_BROADCAST_DEVICEINTERFACE
        {
            public int dbcc_size, dbcc_devicetype, dbcc_reserved;
            public Guid dbcc_classguid;
            public short dbcc_name;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct SP_DEVICE_INTERFACE_DATA
        {
            public int cbSize;
            public Guid InterfaceClassGuid;
            public int Flags;
            public IntPtr Reserved;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct DEVPROPKEY
        {
            public Guid fmtid;
            public uint pid;
        }

        [DllImport("cfgmgr32.dll", CharSet = CharSet.Unicode)] public static extern int CM_Locate_DevNodeW(out uint node, string id, uint flags);
        [DllImport("cfgmgr32.dll", CharSet = CharSet.Unicode)] public static extern int CM_Get_DevNode_PropertyW(uint node, ref DEVPROPKEY key, out uint type, byte[] buffer, ref uint size, uint flags);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr GetModuleHandle(string name);
        [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] public static extern ushort RegisterClass(ref WNDCLASS c);
        [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        public static extern IntPtr CreateWindowEx(uint exStyle, string cls, string title, uint style, int x, int y, int w, int h, IntPtr parent, IntPtr menu, IntPtr instance, IntPtr param);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr DefWindowProc(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam);
        [DllImport("user32.dll")] public static extern int GetMessage(out MSG msg, IntPtr hwnd, uint min, uint max);
        [DllImport("user32.dll")] public static extern bool TranslateMessage(ref MSG msg);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr DispatchMessage(ref MSG msg);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern bool PostMessage(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam);
        [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] public static extern IntPtr RegisterDeviceNotification(IntPtr recipient, IntPtr filter, int flags);

        [DllImport("setupapi.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        public static extern IntPtr SetupDiGetClassDevs(ref Guid guid, IntPtr enumerator, IntPtr parent, int flags);
        [DllImport("setupapi.dll", SetLastError = true)]
        public static extern bool SetupDiDestroyDeviceInfoList(IntPtr set);
        [DllImport("setupapi.dll", SetLastError = true)]
        public static extern bool SetupDiEnumDeviceInterfaces(IntPtr set, IntPtr info, ref Guid guid, uint index, ref SP_DEVICE_INTERFACE_DATA data);
        [DllImport("setupapi.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        public static extern bool SetupDiGetDeviceInterfaceDetail(IntPtr set, ref SP_DEVICE_INTERFACE_DATA data, IntPtr detail, uint size, out uint needed, IntPtr info);
    }

    internal static class Program
    {
        // Windows's name for a whole USB device, as opposed to one of the functions inside it.
        static Guid usbDevice = new Guid("A5DCBF10-6530-11D2-901F-00C04FB951ED");
        // DEVPKEY_Device_BusReportedDeviceDesc: the device's own USB product string.
        static readonly Guid busReportedDesc = new Guid("540B947E-8B40-45BC-A8A2-6A0B894CBDA2");
        static readonly DateTime Epoch = new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        static readonly Native.WndProc proc = Message; // Held here: Windows calls it for as long as the window lives.
        static IntPtr window;
        static StreamWriter output;

        static long Now()
        {
            return (long)(DateTime.UtcNow - Epoch).TotalMilliseconds;
        }

        // Nobody is reading any more: the app is gone.
        static void Say(string line)
        {
            try { output.WriteLine(line); }
            catch (Exception) { Environment.Exit(0); }
        }

        // What the device calls itself, from its node: \\?\USB#VID_2207&PID_0011#<serial>#{...} is the node USB\VID_2207&PID_0011\<serial>.
        // That is the whole device; the functions inside it have their own (MI_00 says "MTP"). Empty when it cannot be read.
        static string NameOf(string path)
        {
            try
            {
                int end = path.LastIndexOf("#{", StringComparison.Ordinal);
                if (end < 4) return "";
                uint node, type, size = 512;
                if (Native.CM_Locate_DevNodeW(out node, path.Substring(4, end - 4).Replace('#', '\\'), 0) != 0) return "";
                var key = new Native.DEVPROPKEY { fmtid = busReportedDesc, pid = 4 };
                var text = new byte[size];
                if (Native.CM_Get_DevNode_PropertyW(node, ref key, out type, text, ref size, 0) != 0) return "";
                return Encoding.Unicode.GetString(text, 0, (int)size).TrimEnd('\0').Replace('\t', ' ').Replace('\r', ' ').Replace('\n', ' ');
            }
            catch (Exception) { return ""; }
        }

        internal static void List()
        {
            IntPtr set = Native.SetupDiGetClassDevs(ref usbDevice, IntPtr.Zero, IntPtr.Zero, Native.DIGCF_PRESENT | Native.DIGCF_DEVICEINTERFACE);
            if (set != new IntPtr(-1))
            {
                try
                {
                    for (uint i = 0; ; i++)
                    {
                        var data = new Native.SP_DEVICE_INTERFACE_DATA();
                        data.cbSize = Marshal.SizeOf(data);
                        if (!Native.SetupDiEnumDeviceInterfaces(set, IntPtr.Zero, ref usbDevice, i, ref data)) break;
                        uint need;
                        Native.SetupDiGetDeviceInterfaceDetail(set, ref data, IntPtr.Zero, 0, out need, IntPtr.Zero);
                        if (need == 0) continue;
                        IntPtr buf = Marshal.AllocHGlobal((int)need);
                        try
                        {
                            Marshal.WriteInt32(buf, IntPtr.Size == 8 ? 8 : 6);
                            if (Native.SetupDiGetDeviceInterfaceDetail(set, ref data, buf, need, out need, IntPtr.Zero))
                            {
                                string path = Marshal.PtrToStringUni(new IntPtr(buf.ToInt64() + 4));
                                Say("= " + Now() + " " + path + "\t" + NameOf(path));
                            }
                        }
                        finally { Marshal.FreeHGlobal(buf); }
                    }
                }
                finally { Native.SetupDiDestroyDeviceInfoList(set); }
            }
            Say("ready " + Now());
        }

        // DEV_BROADCAST_DEVICEINTERFACE: its name starts 28 bytes in, after three ints and a GUID.
        internal static void Changed(int what, IntPtr broadcast)
        {
            if (what != Native.DBT_DEVICEARRIVAL && what != Native.DBT_DEVICEREMOVECOMPLETE) return;
            if (broadcast == IntPtr.Zero || Marshal.ReadInt32(broadcast, 4) != Native.DBT_DEVTYP_DEVICEINTERFACE) return;
            // Stamped first, so reading the name does not count as Windows being late. A device that has left has no node to read.
            long at = Now();
            string path = Marshal.PtrToStringUni(new IntPtr(broadcast.ToInt64() + 28));
            Say(what == Native.DBT_DEVICEARRIVAL ? "+ " + at + " " + path + "\t" + NameOf(path) : "- " + at + " " + path);
        }

        static IntPtr Message(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam)
        {
            if (msg == Native.WM_DEVICECHANGE) { Changed((int)wParam.ToInt64(), lParam); return new IntPtr(1); }
            if (msg == Native.WM_APP) { List(); return IntPtr.Zero; }
            return Native.DefWindowProc(hwnd, msg, wParam, lParam);
        }

        static void ReadStdin()
        {
            try
            {
                string line;
                while ((line = Console.In.ReadLine()) != null)
                    if (line.Trim() == "list") Native.PostMessage(window, Native.WM_APP, IntPtr.Zero, IntPtr.Zero);
            }
            catch (Exception) { }
            Environment.Exit(0);
        }

        static int Fail(string what)
        {
            Say("err " + what + " (Windows error " + Marshal.GetLastWin32Error() + ")");
            return 1;
        }

        [STAThread]
        static int Main()
        {
            output = new StreamWriter(Console.OpenStandardOutput(), new ASCIIEncoding()) { AutoFlush = true, NewLine = "\n" };
            IntPtr instance = Native.GetModuleHandle(null);
            var cls = new Native.WNDCLASS { lpfnWndProc = proc, hInstance = instance, lpszClassName = "TorqueUsbWatch" };
            if (Native.RegisterClass(ref cls) == 0) return Fail("Could not register the window class");
            window = Native.CreateWindowEx(0, "TorqueUsbWatch", "", 0, 0, 0, 0, 0, Native.HWND_MESSAGE, IntPtr.Zero, instance, IntPtr.Zero);
            if (window == IntPtr.Zero) return Fail("Could not create the window");
            // Registered before listing, so a device that comes or goes during the list is still reported after it.
            var filter = new Native.DEV_BROADCAST_DEVICEINTERFACE { dbcc_devicetype = Native.DBT_DEVTYP_DEVICEINTERFACE, dbcc_classguid = usbDevice };
            filter.dbcc_size = Marshal.SizeOf(filter);
            IntPtr mem = Marshal.AllocHGlobal(filter.dbcc_size);
            Marshal.StructureToPtr(filter, mem, false);
            IntPtr note = Native.RegisterDeviceNotification(window, mem, 0);
            Marshal.FreeHGlobal(mem);
            if (note == IntPtr.Zero) return Fail("Could not ask Windows for USB changes");
            List();
            new Thread(ReadStdin) { IsBackground = true }.Start();
            Native.MSG msg;
            while (Native.GetMessage(out msg, IntPtr.Zero, 0, 0) > 0)
            {
                Native.TranslateMessage(ref msg);
                Native.DispatchMessage(ref msg);
            }
            return 0;
        }
    }
}
