/** Registers every subscriber. Loaded lazily by the bus on the first emit (see bus.ts). Order matters: goals first, so the derived goal.progress_changed reaches notifications in the same pass. */
import "./goals";
import "./notifications";
