package android.util;

// Virtual Control Hub stand-in for the FTC SDK 12.0 API. Same package, names and signatures; Torque's own code. Not FIRST code.
public final class Size {
    private final int width, height;
    public Size(int width, int height) { this.width = width; this.height = height; }
    public int getWidth() { return width; }
    public int getHeight() { return height; }
}
