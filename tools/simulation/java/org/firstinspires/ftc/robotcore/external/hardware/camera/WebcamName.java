package org.firstinspires.ftc.robotcore.external.hardware.camera;

// Virtual Control Hub stand-in for the FTC SDK 12.0 API. Same package, names and signatures; Torque's own code. Not FIRST code.
import com.qualcomm.robotcore.hardware.HardwareDevice;

public interface WebcamName extends CameraName, HardwareDevice {
    String getUsbDeviceNameIfAttached();
    boolean isAttached();
}
