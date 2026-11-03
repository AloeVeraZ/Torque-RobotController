package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.hardware.HardwareMap;
import org.firstinspires.ftc.robotcore.external.Telemetry;

/**
 * YOUR mechanism code for the autonomous actions (intake, shooter, arm...). Torque
 * created this file once and never overwrites it. The simulator plans the driving; this file does
 * the rest. Each method is called every loop while its action runs and returns true when finished
 * (RouteActions.java has the rules and the current list of actions).
 *
 * After you add or rename an action in the simulator and export again, its method appears in
 * RouteActions.java: copy it here (keep @Override) and write the code. Delete methods for actions
 * you removed.
 */
public class RobotActions extends RouteActions {
    // Deck's Intake, Spin up, Aim and Shoot already run the mechanisms set up in Deck (Mechanisms.java, as
    // mech). To do one of them your own way, override it here. For example, to shoot with your own code:
    //     @Override
    //     public boolean shoot(Step step) {
    //         // Called every loop until it returns true. Never sleep() here: the robot stops following its path.
    //         return mech.shoot(0, step); // Deck's version: start from it, or replace it
    //     }

    // Example: private DcMotorEx intake;

    @Override
    public void init(HardwareMap hardwareMap, Telemetry telemetry) {
        super.init(hardwareMap, telemetry);
        // Example: intake = hardwareMap.get(DcMotorEx.class, "intake");
    }

    @Override
    public void stop() {
        super.stop();
        // Stop every mechanism you added here.
    }
}
