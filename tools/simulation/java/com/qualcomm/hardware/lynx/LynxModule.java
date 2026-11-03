package com.qualcomm.hardware.lynx;

import com.qualcomm.robotcore.hardware.HardwareDevice;

// Virtual Control Hub stand-in for the FTC SDK 12.0 API (the subset the generated controller and exported
// autonomous code use). Same package, names and signatures; backed by the simulator. Not FIRST code.
// A Control Hub or Expansion Hub (hardwareMap.getAll(LynxModule.class)). Bulk caching is kept as set; the virtual hub
// reads every sensor fresh each loop whatever the mode, so it never hides a missing clearBulkCache().
public abstract class LynxModule implements HardwareDevice {
    public enum BulkCachingMode { OFF, MANUAL, AUTO }
    private BulkCachingMode bulkCachingMode = BulkCachingMode.OFF;
    protected LynxModule() {}
    public BulkCachingMode getBulkCachingMode() { return bulkCachingMode; }
    public void setBulkCachingMode(BulkCachingMode mode) { bulkCachingMode = mode; }
    public void clearBulkCache() {}
    /** The RS485 address: 173 for a Control Hub's own board, 2 for the first Expansion Hub. */
    public abstract int getModuleAddress();
    public abstract boolean isParent();
    public <T> T acquireI2cLockWhile(Supplier<T> supplier) throws InterruptedException, com.qualcomm.robotcore.exception.RobotCoreException, LynxNackException { return supplier.get(); }
    @Override public Manufacturer getManufacturer() { return Manufacturer.Lynx; }
}
