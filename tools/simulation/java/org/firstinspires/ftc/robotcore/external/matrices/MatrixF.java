package org.firstinspires.ftc.robotcore.external.matrices;

// Virtual Control Hub stand-in for the FTC SDK 12.0 API. Same package, names and signatures; Torque's own code. Not FIRST code.
public abstract class MatrixF {
    protected int mRows, mCols;
    public MatrixF(int rows, int cols) { mRows = rows; mCols = cols; }
    public int numRows() { return mRows; }
    public int numCols() { return mCols; }
    public abstract float get(int row, int col);
}
