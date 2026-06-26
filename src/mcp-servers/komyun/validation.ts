import { z } from "zod";

export const apartmentCodeSchema = z
    .string()
    .regex(/^[1-3]-\d{3,4}$/, "Apartment code must include the bloque prefix, e.g. '2-1102' or '1-101'");
