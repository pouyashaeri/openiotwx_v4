/**
 * What each measurement is called in a GDEX-ready file.
 *
 * Every variable gets a `long_name` and `units` (UDUNITS-compatible), and a CF `standard_name` only when
 * one really describes it. Guessing a standard name would be worse than leaving it out, so anything
 * uncertain carries a `comment` instead and shows up in the release's quality report.
 *
 * Standard names: https://cfconventions.org/Data/cf-standard-names/current/build/cf-standard-name-table.html
 * Units: https://docs.unidata.ucar.edu/udunits/current/
 */

export type CfVariable = {
  /** Standard-name table entry, when one fits. */
  standardName?: string;
  longName: string;
  /** UDUNITS string. */
  units: string;
  comment?: string;
  /** Rough physical bounds, used to flag suspicious values in the quality report (never to delete data). */
  plausible?: [number, number];
  /** False for names we do not know: they are still exported, with a warning. */
  mapped: boolean;
};

const C = (standardName: string | undefined, longName: string, units: string, plausible?: [number, number], comment?: string): CfVariable => ({
  standardName,
  longName,
  units,
  plausible,
  comment,
  mapped: true,
});

const TEMP: [number, number] = [-90, 65];

/** The wizard's own metric names. */
const EXACT: Record<string, CfVariable> = {
  temp_c: C("air_temperature", "air temperature", "degree_Celsius", TEMP),
  humidity_pct: C("relative_humidity", "relative humidity", "percent", [0, 100]),
  pressure_hpa: C("air_pressure", "air pressure", "hPa", [300, 1100]),
  rain_mm: C("thickness_of_rainfall_amount", "rainfall depth", "mm", [0, 1000], "Rain depth reported by the station for its reporting interval."),
  wind_ms: C("wind_speed", "wind speed", "m s-1", [0, 90]),
  wind_dir_deg: C("wind_from_direction", "wind direction (direction the wind blows from)", "degree", [0, 360]),
  soil_moisture_pct: C("volume_fraction_of_condensed_water_in_soil", "soil moisture", "percent", [0, 100], "Assumed volumetric water content, as reported by the probe."),
  soil_temp_c: C("soil_temperature", "soil temperature", "degree_Celsius", [-60, 80]),
  pm25_ugm3: C("mass_concentration_of_pm2p5_ambient_aerosol_particles_in_air", "PM2.5 mass concentration", "ug m-3", [0, 2000]),
  pm10_ugm3: C("mass_concentration_of_pm10_ambient_aerosol_particles_in_air", "PM10 mass concentration", "ug m-3", [0, 3000]),
  co2_ppm: C("mole_fraction_of_carbon_dioxide_in_air", "carbon dioxide mole fraction", "1e-6", [250, 10000]),
  o3_ppb: C("mole_fraction_of_ozone_in_air", "ozone mole fraction", "1e-9", [0, 1000]),
  uv_index: C("ultraviolet_index", "UV index", "1", [0, 25]),
};

/**
 * Names the Raspberry Pi gateway sends, as `<sensor>_<measurement>`. They are matched on the
 * measurement part (the same rule the app uses for labels), so any sensor name works.
 */
const GATEWAY: [string, CfVariable][] = [
  ["globe_temperature", C(undefined, "globe temperature", "degree_Celsius", TEMP, "Black-globe sensor reading.")],
  ["globe_humidity", C(undefined, "relative humidity at the globe sensor", "percent", [0, 100])],
  ["relative_humidity", C("relative_humidity", "relative humidity", "percent", [0, 100])],
  ["temperature", C("air_temperature", "air temperature", "degree_Celsius", TEMP)],
  ["pressure", C("air_pressure", "air pressure", "hPa", [300, 1100])],
  ["co2_concentration", C("mole_fraction_of_carbon_dioxide_in_air", "carbon dioxide mole fraction", "1e-6", [250, 10000])],
  ["uv_light", C(undefined, "ultraviolet light sensor reading", "1", undefined, "Raw sensor value; not a calibrated UV index.")],
  ["ambient_light", C(undefined, "ambient illuminance", "lux", [0, 200000])],
  ["pm10_standard", C("mass_concentration_of_pm1_ambient_aerosol_particles_in_air", "PM1.0 mass concentration (manufacturer standard calibration)", "ug m-3", [0, 2000])],
  ["pm25_standard", C("mass_concentration_of_pm2p5_ambient_aerosol_particles_in_air", "PM2.5 mass concentration (manufacturer standard calibration)", "ug m-3", [0, 2000])],
  ["pm100_standard", C("mass_concentration_of_pm10_ambient_aerosol_particles_in_air", "PM10 mass concentration (manufacturer standard calibration)", "ug m-3", [0, 3000])],
  ["rainfall_total", C(undefined, "accumulated rainfall", "mm", [0, 100000], "Running total reported by the gauge.")],
  ["rain_intensity", C("rainfall_rate", "rainfall rate", "mm h-1", [0, 1000])],
  ["gas_resistance", C(undefined, "gas sensor resistance", "ohm", undefined, "Raw sensor value (volatile organic compounds proxy).")],
  ["mrt", C(undefined, "mean radiant temperature", "degree_Celsius", TEMP, "Supplied by the station; not computed by OpenIoTwx.")],
  ["ws", C("wind_speed", "wind speed", "m s-1", [0, 90])],
  ["wd", C("wind_from_direction", "wind direction (direction the wind blows from)", "degree", [0, 360])],
];

/** The CF description of a measurement name. Unknown names are kept, with `mapped: false`. */
export function cfFor(key: string): CfVariable {
  const exact = EXACT[key];
  if (exact) return exact;
  const hit = GATEWAY.find(([m]) => key === m || key.endsWith(`_${m}`));
  if (hit) return hit[1];
  return { longName: key.replace(/_/g, " "), units: "1", mapped: false, comment: "No standard name or units are known for this measurement." };
}

/** Every measurement name the platform knows how to describe, for the public variable catalogue. */
export function cfCatalog(): ({ name: string; match: "exact" | "suffix" } & Omit<CfVariable, "plausible">)[] {
  const strip = ({ plausible: _p, ...rest }: CfVariable) => rest;
  return [
    ...Object.entries(EXACT).map(([name, v]) => ({ name, match: "exact" as const, ...strip(v) })),
    ...GATEWAY.map(([name, v]) => ({ name, match: "suffix" as const, ...strip(v) })),
  ];
}

/** A name that is safe as a NetCDF variable name (CF: letters, digits and underscores, starting with a letter). */
export function ncName(key: string): string {
  const s = key.replace(/[^A-Za-z0-9_]/g, "_");
  return /^[A-Za-z]/.test(s) ? s : `v_${s}`;
}
