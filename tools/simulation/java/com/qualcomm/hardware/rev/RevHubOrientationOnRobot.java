package com.qualcomm.hardware.rev;

import com.qualcomm.robotcore.hardware.ImuOrientationOnRobot;
import org.firstinspires.ftc.robotcore.external.navigation.Quaternion;

// Virtual Control Hub stand-in for the FTC SDK 12.0 API (the subset the generated controller and exported
// autonomous code use). Same package, names and signatures; backed by the simulator. Not FIRST code.
public class RevHubOrientationOnRobot implements ImuOrientationOnRobot {
    public enum LogoFacingDirection { UP, DOWN, FORWARD, BACKWARD, LEFT, RIGHT }
    public enum UsbFacingDirection { UP, DOWN, FORWARD, BACKWARD, LEFT, RIGHT }
    private final LogoFacingDirection logoFacingDirection;
    private final UsbFacingDirection usbFacingDirection;
    public RevHubOrientationOnRobot(LogoFacingDirection logoFacingDirection, UsbFacingDirection usbFacingDirection) {
        if (logoFacingDirection.ordinal() / 2 == usbFacingDirection.ordinal() / 2) throw new IllegalArgumentException("The logo and USB port cannot face along the same axis.");
        this.logoFacingDirection = logoFacingDirection;
        this.usbFacingDirection = usbFacingDirection;
    }
    public RevHubOrientationOnRobot(Quaternion rotation) {
        if (rotation == null) throw new IllegalArgumentException("A rotation is needed.");
        this.logoFacingDirection = LogoFacingDirection.UP;
        this.usbFacingDirection = UsbFacingDirection.FORWARD;
    }
}
