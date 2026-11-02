package org.firstinspires.ftc.robotcore.external.hardware.camera.controls;

// Virtual Control Hub stand-in for the FTC SDK 12.0 API. Same package, names and signatures; Torque's own code. Not FIRST code.
import java.util.concurrent.TimeUnit;

public interface ExposureControl extends CameraControl {
    enum Mode {
        Unknown, Auto, ContinuousAuto, Manual, ShutterPriority, AperturePriority;
        public static Mode fromId(int id) { return id >= 0 && id < values().length ? values()[id] : Unknown; }
    }
    long unknownExposure = 0;
    Mode getMode();
    boolean setMode(Mode mode);
    boolean isModeSupported(Mode mode);
    long getMinExposure(TimeUnit resultUnit);
    long getMaxExposure(TimeUnit resultUnit);
    long getExposure(TimeUnit resultUnit);
    boolean setExposure(long duration, TimeUnit durationUnit);
    boolean isExposureSupported();
    boolean getAePriority();
    boolean setAePriority(boolean priority);
}
