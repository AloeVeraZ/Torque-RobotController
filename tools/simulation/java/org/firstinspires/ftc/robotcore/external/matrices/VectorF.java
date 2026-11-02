package org.firstinspires.ftc.robotcore.external.matrices;

// Virtual Control Hub stand-in for the FTC SDK 12.0 API. Same package, names and signatures; Torque's own code. Not FIRST code.
public class VectorF {
    protected final float[] data;
    public VectorF(float[] data) { this.data = data; }
    public VectorF(float x, float y, float z) { this(new float[] { x, y, z }); }
    public int length() { return data.length; }
    public float get(int index) { return data[index]; }
}
