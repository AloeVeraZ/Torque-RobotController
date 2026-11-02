package org.firstinspires.ftc.robotcore.external.navigation;

// Virtual Control Hub stand-in for the FTC SDK 12.0 API. Same package, names and signatures; Torque's own code. Not FIRST code.
public class Quaternion {
    public float w, x, y, z;
    public long acquisitionTime;
    public static Quaternion identityQuaternion() { return new Quaternion(1, 0, 0, 0, 0); }
    public Quaternion() { this(0, 0, 0, 0, 0); }
    public Quaternion(float w, float x, float y, float z, long acquisitionTime) { this.w = w; this.x = x; this.y = y; this.z = z; this.acquisitionTime = acquisitionTime; }
}
