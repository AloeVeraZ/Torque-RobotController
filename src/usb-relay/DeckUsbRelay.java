import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.util.Collections;

/**
 * The Driver Station's cable to a Control Hub. ADB forwards TCP but not UDP, and the Robot Controller speaks Robocol over
 * UDP, so this passes packets between the two. Over TCP each packet is a 2-byte length and the packet.
 *
 * Deck runs it from a temporary file with `adb shell app_process`, as the hub's unprivileged shell user. Nothing is
 * installed: the Robot Controller app, the team's code, its configurations and the hub's firmware are not touched. It
 * ends when its standard input closes (the cable is pulled or Deck closes), and Deck removes the file as soon as it runs.
 * Rebuild with tools/build-usb-relay.cjs.
 */
public final class DeckUsbRelay {
    private static final int PORT = 20885, ROBOCOL_PORT = 20884;

    public static void main(String[] args) throws Exception {
        final ServerSocket server = new ServerSocket(PORT, 1, InetAddress.getByName("127.0.0.1"));
        Thread life = new Thread(new Runnable() {
            @Override public void run() {
                try { while (System.in.read() >= 0) { } } catch (IOException ignored) { }
                System.exit(0);
            }
        }, "life");
        life.setDaemon(true);
        life.start();
        System.out.println("ready");
        System.out.flush();
        while (true) {
            Socket station = server.accept();
            try {
                relay(station);
            } catch (IOException ignored) {
                // The station went away: wait for the next one.
            } finally {
                try { station.close(); } catch (IOException ignored) { }
            }
        }
    }

    /** Where the Robot Controller listens: 192.168.43.1 on a Control Hub, else this device's first network address. */
    private static InetAddress controllerAddress() throws IOException {
        InetAddress first = null;
        for (NetworkInterface n : Collections.list(NetworkInterface.getNetworkInterfaces())) {
            if (!n.isUp() || n.isLoopback()) continue;
            for (InetAddress a : Collections.list(n.getInetAddresses())) {
                if (!(a instanceof Inet4Address)) continue;
                if ("192.168.43.1".equals(a.getHostAddress())) return a;
                if (first == null) first = a;
            }
        }
        return first != null ? first : InetAddress.getByName("192.168.43.1");
    }

    private static void relay(Socket station) throws IOException {
        station.setTcpNoDelay(true);
        final DatagramSocket udp = new DatagramSocket(null);
        udp.setReuseAddress(true);
        udp.bind(new InetSocketAddress(InetAddress.getByName("127.0.0.1"), ROBOCOL_PORT));
        final InetSocketAddress controller = new InetSocketAddress(controllerAddress(), ROBOCOL_PORT);
        final DataInputStream in = new DataInputStream(new BufferedInputStream(station.getInputStream()));
        final DataOutputStream out = new DataOutputStream(new BufferedOutputStream(station.getOutputStream()));
        Thread answers = new Thread(new Runnable() {
            @Override public void run() {
                byte[] buffer = new byte[65535];
                DatagramPacket packet = new DatagramPacket(buffer, buffer.length);
                try {
                    while (!udp.isClosed()) {
                        packet.setLength(buffer.length);
                        udp.receive(packet);
                        synchronized (out) {
                            out.writeShort(packet.getLength());
                            out.write(buffer, 0, packet.getLength());
                            out.flush();
                        }
                    }
                } catch (IOException ignored) {
                    // Closed with the station.
                }
            }
        }, "answers");
        answers.setDaemon(true);
        answers.start();
        try {
            while (true) {
                int length = in.readUnsignedShort();
                byte[] bytes = new byte[length];
                in.readFully(bytes);
                udp.send(new DatagramPacket(bytes, length, controller));
            }
        } finally {
            udp.close();
        }
    }
}
