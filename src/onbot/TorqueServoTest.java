import com.qualcomm.hardware.lynx.LynxModule;
import com.qualcomm.hardware.lynx.LynxNackException;
import com.qualcomm.hardware.lynx.commands.core.LynxSetServoConfigurationCommand;
import com.qualcomm.hardware.lynx.commands.core.LynxSetServoEnableCommand;
import com.qualcomm.hardware.lynx.commands.core.LynxSetServoPulseWidthCommand;
import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;

import java.io.BufferedReader;
import java.io.FileReader;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

/**
 * Torque's Servo Test (Setup & Calibrate → Servo Test). Torque puts this file on the robot with OnBot Java and runs it as a
 * Driver Station does; it is not Torque Debug and shares nothing with it. It needs no robot configuration: it drives one of the
 * Control Hub's own servo ports directly, with the hub's own pulse generator, so the pulses are as clean as any servo's.
 *
 * What to send comes from a plan Torque writes over USB, /sdcard/FIRST/torque-servo-test.txt:
 *   hub 173         which hub, by its RS485 address: 173 is the Control Hub's own, 2 the first Expansion Hub (it must be in the
 *                   robot's active configuration for the SDK to reach it); 0 or none: the Control Hub
 *   port 0          the hub's servo port (0-5)
 *   enable 1        1: the port is turned on; 0: the pulses are written but the port stays off (nothing moves)
 *   live 1          live: the pulse below is played until STOP, and the plan is read again every 50 ms (Torque's slider)
 *   seq 17          live: Torque's count, raised at least once a second; unchanged for 3 s means Torque is gone: port off
 *   us 1500         live: the pulse now, in µs (1-2500), or 0 for no pulse (port off)
 *   1500 1500       otherwise: a pulse in µs (500-2500) and how long to hold it in ms (20-10000), one line a step, played once
 * It says where it is in telemetry ("torque.state", "torque.step", "torque.pulse", and the hub's own reading of the port as
 * "torque.hub"), and turns the port off at the end, on STOP, or if anything fails. It opens no network port and streams nothing:
 * the Driver Station's own telemetry is all that goes back.
 *
 * Just after Torque builds this, the Robot Controller can still run the copy it had loaded; Torque INITs again until this
 * one reports the plan (torque.plan).
 *
 * No package: Sinister, in some Robot Controller builds, crashes the app on any OnBot Java class in one.
 */
@TeleOp(name = "TorqueServoTest", group = "Torque")
public class TorqueServoTest extends LinearOpMode {
    static final String PLAN = "/sdcard/FIRST/torque-servo-test.txt";
    static final long LIVE_EVERY_MS = 50, TORQUE_GONE_MS = 3000;

    /** One reading of the plan file. */
    static class Plan {
        int port = 0, us = 0, hub = 0;
        boolean enable = true, live = false;
        String seq = "", problem = null;
        boolean hasUs = false;
        final List<int[]> steps = new ArrayList<>();
    }

    static Plan read() {
        Plan p = new Plan();
        try (BufferedReader r = new BufferedReader(new FileReader(PLAN))) {
            for (String line; (line = r.readLine()) != null; ) {
                String[] f = line.trim().split("\\s+");
                if (f.length < 2) continue;
                if (f[0].equals("port")) p.port = Math.max(0, Math.min(5, Integer.parseInt(f[1])));
                else if (f[0].equals("hub")) p.hub = Math.max(0, Math.min(254, Integer.parseInt(f[1])));
                else if (f[0].equals("enable")) p.enable = !"0".equals(f[1]);
                else if (f[0].equals("live")) p.live = "1".equals(f[1]);
                else if (f[0].equals("seq")) p.seq = f[1];
                else if (f[0].equals("us")) { p.us = Math.max(0, Math.min(2500, Integer.parseInt(f[1]))); p.hasUs = true; }
                else p.steps.add(new int[]{Math.max(500, Math.min(2500, Integer.parseInt(f[0]))), Math.max(20, Math.min(10000, Integer.parseInt(f[1])))});
            }
        } catch (IOException | RuntimeException e) {
            p.problem = e.getClass().getSimpleName() + ": " + e.getMessage();
        }
        return p;
    }

    @Override
    public void runOpMode() throws InterruptedException {
        Plan plan = read();
        // The hub asked for, by address; with none, the Control Hub's own (the parent module).
        LynxModule hub = null;
        StringBuilder seen = new StringBuilder();
        for (LynxModule h : hardwareMap.getAll(LynxModule.class)) {
            if (seen.length() > 0) seen.append(',');
            seen.append(h.getModuleAddress()).append(h.isParent() ? "p" : "");
            if (plan.hub > 0 ? h.getModuleAddress() == plan.hub : h.isParent()) hub = h;
        }
        if (hub == null && plan.hub == 0 && !hardwareMap.getAll(LynxModule.class).isEmpty()) hub = hardwareMap.getAll(LynxModule.class).get(0);
        telemetry.addData("torque.hubs", "%s", seen);
        boolean usable = plan.problem == null && (plan.live || !plan.steps.isEmpty());
        String ready = !usable ? "No test plan: run the Servo Test from Torque." + (plan.problem == null ? "" : " (" + plan.problem + ")")
            : hub == null ? (plan.hub > 0 ? "Hub " + plan.hub + " is not in the robot's active configuration: add it in Configure, then try again." : "No Control Hub found.") : "ready";
        telemetry.addData("torque.state", ready);
        telemetry.addData("torque.plan", plan.live ? "servo port %d, live" : "servo port %d, %d steps", plan.port, plan.steps.size());
        telemetry.update();
        waitForStart();
        if (!usable || hub == null) return;
        int port = plan.port;
        try {
            new LynxSetServoConfigurationCommand(hub, port, 20000).send();
            if (plan.live) live(hub, port, plan);
            else steps(hub, port, plan);
            telemetry.addData("torque.state", opModeIsActive() ? "done" : "stopped");
        } catch (LynxNackException | RuntimeException e) {
            telemetry.addData("torque.state", "error %s", e.getMessage());
        } finally {
            try { new LynxSetServoEnableCommand(hub, port, false).send(); } catch (LynxNackException | RuntimeException ignored) { }
            telemetry.addData("torque.hub", "%s", reading(hub, port));
            telemetry.update();
        }
    }

    /** The steps, once, in order. */
    void steps(LynxModule hub, int port, Plan plan) throws InterruptedException, LynxNackException {
        for (int i = 0; i < plan.steps.size() && opModeIsActive(); i++) {
            int us = plan.steps.get(i)[0];
            new LynxSetServoPulseWidthCommand(hub, port, us).send();
            if (i == 0) new LynxSetServoEnableCommand(hub, port, plan.enable).send();
            long end = System.currentTimeMillis() + plan.steps.get(i)[1];
            while (opModeIsActive() && System.currentTimeMillis() < end) {
                telemetry.addData("torque.state", "running");
                telemetry.addData("torque.step", "%d/%d", i + 1, plan.steps.size());
                telemetry.addData("torque.pulse", "%d", us);
                telemetry.addData("torque.hub", "%s", reading(hub, port));
                telemetry.update();
                sleep(50);
            }
        }
    }

    /** Torque's slider: the newest pulse in the plan, until STOP. 0 is no pulse; Torque gone for 3 s is no pulse too. */
    void live(LynxModule hub, int port, Plan first) throws InterruptedException, LynxNackException {
        String seq = first.seq;
        long heard = System.currentTimeMillis();
        int applied = -1;
        boolean on = false;
        Plan now = first;
        while (opModeIsActive()) {
            Plan next = read();
            // Only a whole plan counts: one caught half written (no count or no pulse yet) is skipped.
            if (next.problem == null && next.live && !next.seq.isEmpty() && next.hasUs) now = next;
            long t = System.currentTimeMillis();
            if (!now.seq.equals(seq)) { seq = now.seq; heard = t; }
            boolean gone = t - heard > TORQUE_GONE_MS;
            int want = gone ? 0 : now.us;
            if (want != applied) {
                if (want <= 0) { if (on) new LynxSetServoEnableCommand(hub, port, false).send(); on = false; }
                else { new LynxSetServoPulseWidthCommand(hub, port, want).send(); if (!on && first.enable) { new LynxSetServoEnableCommand(hub, port, true).send(); on = true; } }
                applied = want;
            }
            telemetry.addData("torque.state", gone ? "waiting" : "live");
            telemetry.addData("torque.pulse", "%d", Math.max(0, want));
            telemetry.addData("torque.volts", "%s", volts(hub));
            telemetry.addData("torque.hub", "%s", reading(hub, port));
            telemetry.update();
            sleep(LIVE_EVERY_MS);
        }
    }

    /** The hub's battery input in volts ("12.6"), or "?". Servo ports take their power from it: with no battery the hub keeps a
     *  port off even when told to turn it on. Asked by name, like the readings below, so a different SDK cannot break the build. */
    static String volts(LynxModule hub) {
        try {
            for (java.lang.reflect.Method m : hub.getClass().getMethods()) {
                if (!m.getName().equals("getInputVoltage") || m.getParameterTypes().length != 1 || !m.getParameterTypes()[0].isEnum()) continue;
                Object volts = null;
                for (Object unit : m.getParameterTypes()[0].getEnumConstants()) if (String.valueOf(unit).equals("VOLTS")) volts = unit;
                Object v = m.invoke(hub, volts);
                if (v instanceof Number) return String.format(java.util.Locale.US, "%.1f", ((Number) v).doubleValue());
            }
        } catch (Exception | LinkageError ignored) { }
        return "?";
    }

    /** The hub's own reading of the port: "1500 on", "1500 off", or "?" when this SDK cannot say. Asked by name so a different SDK cannot break the build. */
    static String reading(LynxModule hub, int port) {
        Object us = ask(hub, port, "LynxGetServoPulseWidthCommand", "getPulseWidth"), on = ask(hub, port, "LynxGetServoEnableCommand", "isEnabled");
        return (us instanceof Number ? String.valueOf(((Number) us).intValue()) : "?") + " " + (on instanceof Boolean ? ((Boolean) on ? "on" : "off") : "?");
    }

    static Object ask(LynxModule hub, int port, String command, String getter) {
        try {
            Class<?> k = Class.forName("com.qualcomm.hardware.lynx.commands.core." + command);
            Object c = null;
            for (java.lang.reflect.Constructor<?> k2 : k.getConstructors()) { Class<?>[] p = k2.getParameterTypes(); if (p.length == 2 && p[0].isInstance(hub) && p[1] == int.class) { c = k2.newInstance(hub, port); break; } }
            if (c == null) return null;
            Object r = k.getMethod("sendReceive").invoke(c);
            return r == null ? null : r.getClass().getMethod(getter).invoke(r);
        } catch (Exception | LinkageError e) { return null; }
    }
}
