# Find a robot on its own Wi-Fi

On Drive, pick **Other robot** under **Add a robot**: **Find robot automatically** is below its address controls. Connect to
the Wi-Fi emitted by the robot, confirm **This Wi-Fi is emitted by my robot, not
a home/shared network**, then press **Find robot automatically**. Confirmation
clears when the connected SSID or Wi-Fi adapter changes. There is no background
subnet sweep and no automatic enablement based on a network name or lost internet.

The app reads the connected Wi-Fi adapter's DHCP gateway, address, and prefix.
It excludes gateways outside that private subnet, local/broadcast addresses,
known internet-connected networks and captive portals. Missing adapter/gateway
details leave manual entry available. SteamOS/Windows report OS connectivity;
macOS reports unknown here. Unknown does not mean offline and still requires
your explicit hotspot confirmation.

It checks **one host**, that gateway: a short FTC peer-discovery request, followed
by HTTP GET `/` on ports **80, 5000, 8080** if FTC does not answer. Requests bind to
the Wi-Fi address. They never initialize/enable a robot or send drive commands.
HTML pages, HTTP sign-in challenges, and same-origin redirects can supply an
address. Discovery does not follow redirects or send credentials. Multiple
answers require selection. A single answer fills the URL; **Open robot** remains
the explicit connection action, preserving the normal sign-in and save behavior.
Active robot connections must be closed before discovery. Switching networks or
cancelling rejects stale results; it does not replace existing saved robots.

The gateway need not be `192.168.1.x`. ESP SoftAP examples use `192.168.4.1`, FTC
Control Hubs use `192.168.43.1:8080`, and NetworkManager shared connections can use
`10.42.x.1`. The app uses the actual route instead of guessing a hardware family.
Wi-Fi frequency bands do not identify the robot's address. No internet is only a
clue: an offline home router also has no internet. A Wi-Fi client cannot reliably
count all peers or prove that a gateway is a robot, so the user must identify the
hotspot. Discovery is disabled by default on every new connection. Do not enable
it on home/shared Wi-Fi; use saved/manual addresses there.

Robots hosted on another client, IPv6-only networks, HTTPS-only servers, unusual
ports, or hardware without a web UI need a manual address or their own protocol.
A responding website is a candidate, not authenticated proof of robot identity.

Sources: [Espressif Wi-Fi AP API](https://docs.espressif.com/projects/arduino-esp32/en/latest/api/wifi.html),
[NetworkManager shared addresses](https://networkmanager.pages.freedesktop.org/NetworkManager/NetworkManager/nm-settings-nmcli.html),
[NetworkManager connectivity states](https://networkmanager.pages.freedesktop.org/NetworkManager/NetworkManager/nmcli.html),
[FIRST Control Hub connection](https://ftc-docs.firstinspires.org/en/latest/programming_resources/shared/managing_control_hub/Managing-a-Control-Hub.html).
