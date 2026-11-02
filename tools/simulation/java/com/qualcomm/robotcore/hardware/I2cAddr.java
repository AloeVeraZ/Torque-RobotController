package com.qualcomm.robotcore.hardware;

// Virtual Control Hub stand-in for the FTC SDK 12.0 API. Same package, names and signatures. Not FIRST code.
public class I2cAddr {
    private final int address7Bit;
    public I2cAddr(int address7Bit) { this.address7Bit = address7Bit & 0x7F; }
    public static I2cAddr create7bit(int address) { return new I2cAddr(address); }
    public int get7Bit() { return address7Bit; }
}
