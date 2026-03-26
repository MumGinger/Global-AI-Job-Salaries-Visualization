const DATA_URL = "ai_jobs_market_2025_2026.csv";
// The page includes an on-page Sources block so the dataset and map geometry
// used by the visualization are acknowledged directly in the prototype itself.
const WORLD_ATLAS_SOURCES = [
  "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json",
  "https://unpkg.com/world-atlas@2/countries-110m.json",
];
const ALL_VALUE = "__ALL__";
const DEFAULT_FILTER_TYPE = "job_category";
const FILTER_TYPES = {
  [DEFAULT_FILTER_TYPE]: {
    label: "Job category",
    allLabel: "All job categories",
    rowKey: "jobCategory",
  },
  industry: {
    label: "Industry",
    allLabel: "All industries",
    rowKey: "industry",
  },
};
const EXPERIENCE_LEVELS = d3.range(1, 16);

const columnCandidates = {
  city: ["city", "job_city", "location_city"],
  country: ["country", "location_country"],
  jobCategory: ["job_category", "job category", "category"],
  industry: ["industry"],
  yearsOfExperience: [
    "years_of_experience",
    "years of experience",
    "experience_years",
    "experience",
  ],
  annualSalaryUsd: [
    "annual_salary_usd",
    "annual salary usd",
    "salary_usd",
    "salary",
  ],
};

// Coordinate lookup scaffold extracted from the CSV's unique city names.
// If a city is missing or plotted in the wrong place, update its { lat, lon }
// value here. Any city without usable coordinates is skipped on the map while
// still remaining available in the box plot when no location is selected.
const cityCoordinates = {
  Amsterdam: { lat: 52.3676, lon: 4.9041 },
  Austin: { lat: 30.2672, lon: -97.7431 },
  Bangalore: { lat: 12.9716, lon: 77.5946 },
  Beijing: { lat: 39.9042, lon: 116.4074 },
  Berlin: { lat: 52.52, lon: 13.405 },
  Boston: { lat: 42.3601, lon: -71.0589 },
  Chicago: { lat: 41.8781, lon: -87.6298 },
  Dubai: { lat: 25.2048, lon: 55.2708 },
  London: { lat: 51.5072, lon: -0.1276 },
  "Los Angeles": { lat: 34.0522, lon: -118.2437 },
  "New York": { lat: 40.7128, lon: -74.006 },
  Paris: { lat: 48.8566, lon: 2.3522 },
  Remote: null,
  "San Francisco": { lat: 37.7749, lon: -122.4194 },
  Seattle: { lat: 47.6062, lon: -122.3321 },
  Singapore: { lat: 1.3521, lon: 103.8198 },
  Sydney: { lat: -33.8688, lon: 151.2093 },
  Tokyo: { lat: 35.6762, lon: 139.6503 },
  Toronto: { lat: 43.6532, lon: -79.3832 },
  Zurich: { lat: 47.3769, lon: 8.5417 },
};

// Single shared state keeps the map, controls, summary, and box plot coordinated.
const state = {
  rows: [],
  worldFeatures: [],
  columns: null,
  selectedLocation: null,
  // Only one attribute filter is active at a time: the chosen type plus
  // the selected value within that attribute.
  selectedFilterType: DEFAULT_FILTER_TYPE,
  selectedFilterValue: ALL_VALUE,
  globalSalaryExtent: [0, 0],
  allExperienceLevels: [],
  knownLocations: [],
  mapSummaries: [],
  remoteSummary: null,
  zoomTransform: d3.zoomIdentity,
};

const dom = {
  filterTypeSelect: document.getElementById("filter-type-select"),
  filterValueSelect: document.getElementById("filter-value-select"),
  resetCityButton: document.getElementById("reset-city-button"),
  summaryScope: document.getElementById("summary-scope"),
  summaryDetail: document.getElementById("summary-detail"),
  boxPanelTitle: document.getElementById("box-panel-title"),
  chartPanelHint: document.getElementById("chart-panel-hint"),
  boxMetrics: document.getElementById("box-metrics"),
  mapStatus: document.getElementById("map-status"),
  tooltip: d3.select("#tooltip"),
};

const mapConfig = {
  width: 1120,
  height: 470,
  remoteX: 76,
  remoteY: 414,
  focusScale: 2.35,
};

const MAP_DOT_RADIUS = 4.8;

const boxConfig = {
  width: 1120,
  height: 430,
  margin: { top: 28, right: 26, bottom: 64, left: 88 },
};

const mapSvg = d3.select("#map-svg");
const boxSvg = d3.select("#boxplot-svg");

const mapLayers = {
  root: null,
  viewport: null,
  sphere: null,
  countries: null,
  markers: null,
  overlay: null,
  remote: null,
};

const boxLayers = {
  root: null,
  yGrid: null,
  xGrid: null,
  xAxis: null,
  yAxis: null,
  boxes: null,
  scatter: null,
  message: null,
};

let mapProjection;
let mapPath;
let mapZoom;
let xScale;
let yScale;

loadData();

async function loadData() {
  try {
    const [rawRows, worldAtlas] = await Promise.all([
      d3.csv(DATA_URL),
      loadWorldAtlas(),
    ]);
    state.columns = detectColumns(
      rawRows.columns || Object.keys(rawRows[0] || {}),
    );
    state.rows = preprocessData(rawRows, state.columns);
    state.worldFeatures = topojson.feature(
      worldAtlas,
      worldAtlas.objects.countries,
    ).features;
    state.globalSalaryExtent = d3.extent(state.rows, (d) => d.annualSalaryUsd);
    state.allExperienceLevels = [...EXPERIENCE_LEVELS];

    syncCityCoordinateLookup(state.rows);
    initMap();
    initBoxPlot();
    initControls();
    updateFilterControls();
    updateAll();
  } catch (error) {
    console.error(error);
    showLoadError(error);
  }
}

async function loadWorldAtlas() {
  for (const source of WORLD_ATLAS_SOURCES) {
    try {
      return await d3.json(source);
    } catch (error) {
      console.warn(`Could not load world atlas from ${source}`, error);
    }
  }

  throw new Error(
    "Unable to load the world map data. Check your internet connection or download the atlas JSON locally.",
  );
}

function detectColumns(columns) {
  const normalizedLookup = new Map(
    columns.map((columnName) => [normalizeColumnName(columnName), columnName]),
  );

  return Object.fromEntries(
    Object.entries(columnCandidates).map(([key, candidates]) => {
      const matched = candidates
        .map((candidate) =>
          normalizedLookup.get(normalizeColumnName(candidate)),
        )
        .find(Boolean);

      if (!matched) {
        throw new Error(`Required column not found for "${key}".`);
      }

      return [key, matched];
    }),
  );
}

function preprocessData(rawRows, columns) {
  return rawRows
    .map((row, index) => {
      const city = cleanText(row[columns.city]);
      const country = cleanText(row[columns.country]) || "Unknown";
      const jobCategory = cleanText(row[columns.jobCategory]);
      const industry = cleanText(row[columns.industry]);
      const yearsOfExperience = Number.parseFloat(
        row[columns.yearsOfExperience],
      );
      const annualSalaryUsd = Number.parseFloat(row[columns.annualSalaryUsd]);

      return {
        rowId: index,
        city,
        country,
        jobCategory,
        industry,
        yearsOfExperience,
        annualSalaryUsd,
      };
    })
    .filter(
      (row) =>
        row.city &&
        Number.isFinite(row.yearsOfExperience) &&
        Number.isFinite(row.annualSalaryUsd),
    );
}

function syncCityCoordinateLookup(rows) {
  state.knownLocations = Array.from(new Set(rows.map((d) => d.city))).sort(
    d3.ascending,
  );

  state.knownLocations.forEach((city) => {
    if (!(city in cityCoordinates)) {
      cityCoordinates[city] = null;
    }
  });
}

function initMap() {
  mapSvg.selectAll("*").remove();

  mapProjection = d3.geoNaturalEarth1().fitExtent(
    [
      [16, 18],
      [mapConfig.width - 16, mapConfig.height - 44],
    ],
    { type: "FeatureCollection", features: state.worldFeatures },
  );

  mapPath = d3.geoPath(mapProjection);

  mapLayers.root = mapSvg.append("g");
  mapLayers.viewport = mapLayers.root.append("g");
  mapLayers.sphere = mapLayers.viewport
    .append("path")
    .attr("class", "sphere-outline");
  mapLayers.countries = mapLayers.viewport.append("g");
  mapLayers.markers = mapLayers.viewport.append("g");
  mapLayers.overlay = mapLayers.root.append("g");
  mapLayers.remote = mapLayers.overlay
    .append("g")
    .attr("class", "remote-marker-group")
    .attr("transform", `translate(${mapConfig.remoteX},${mapConfig.remoteY})`);

  mapLayers.sphere.datum({ type: "Sphere" }).attr("d", mapPath);

  mapLayers.countries
    .selectAll("path")
    .data(state.worldFeatures)
    .join("path")
    .attr("class", "map-country")
    .attr("d", mapPath);

  // Zoom is kept restrained: users can pan/scroll, and city clicks trigger
  // a smooth focus transform centered on the selected location.
  mapZoom = d3
    .zoom()
    .scaleExtent([1, 5])
    .translateExtent([
      [0, 0],
      [mapConfig.width, mapConfig.height],
    ])
    .extent([
      [0, 0],
      [mapConfig.width, mapConfig.height],
    ])
    .on("zoom", handleMapZoom);

  mapSvg.call(mapZoom).on("dblclick.zoom", null);

  mapLayers.remote
    .append("circle")
    .attr("class", "remote-dot")
    .attr("r", MAP_DOT_RADIUS);

  mapLayers.remote
    .append("text")
    .attr("class", "remote-label")
    .attr("x", 12)
    .attr("y", 4)
    .text("Remote");

  mapLayers.remote
    .on("mouseenter", (event) => {
      if (state.remoteSummary) {
        handleLocationTooltipEnter(event, state.remoteSummary);
      }
    })
    .on("mousemove", handleTooltipMove)
    .on("mouseleave", hideTooltip)
    .on("click", () => {
      if (state.remoteSummary) {
        toggleLocationSelection("Remote");
      }
    });
}

function handleMapZoom(event) {
  state.zoomTransform = event.transform;
  mapLayers.viewport.attr("transform", event.transform);
  applyMapZoomStyles();
}

function applyMapZoomStyles() {
  const inverseScale = 1 / state.zoomTransform.k;

  mapLayers.sphere.attr("stroke-width", 1.1 * inverseScale);
  mapLayers.countries
    .selectAll("path")
    .attr("stroke-width", 0.8 * inverseScale);

  mapLayers.markers
    .selectAll(".location-marker")
    .select("circle")
    .attr("r", (d) => d.baseRadius * inverseScale)
    .attr(
      "stroke-width",
      (d) => (d.city === state.selectedLocation ? 1.9 : 1.2) * inverseScale,
    );

  mapLayers.markers
    .selectAll(".city-label")
    .attr("x", (d) => (d.baseRadius + 5) * inverseScale)
    .attr("y", 3 * inverseScale)
    .style("font-size", `${10 * inverseScale}px`)
    .style("stroke-width", `${3 * inverseScale}px`);
}

function initControls() {
  dom.filterTypeSelect.addEventListener("change", (event) => {
    state.selectedFilterType = event.target.value;
    state.selectedFilterValue = ALL_VALUE;
    updateFilterControls();
    updateAll();
  });

  dom.filterValueSelect.addEventListener("change", (event) => {
    state.selectedFilterValue = event.target.value;
    updateFilterControls();
    updateAll();
  });

  dom.resetCityButton.addEventListener("click", () => {
    // Reset restores the default single-filter view and clears the location
    // focus before returning the map to its global zoom state.
    state.selectedLocation = null;
    state.selectedFilterType = DEFAULT_FILTER_TYPE;
    state.selectedFilterValue = ALL_VALUE;
    updateFilterControls();
    updateAll();
    resetMapZoom();
  });
}

function initBoxPlot() {
  boxSvg.selectAll("*").remove();

  const innerWidth = getBoxInnerWidth();
  const innerHeight = getBoxInnerHeight();

  xScale = d3
    .scaleBand()
    .domain(state.allExperienceLevels)
    .range([0, innerWidth])
    .paddingInner(0.26)
    .paddingOuter(0.08);

  yScale = d3
    .scaleLinear()
    .domain(getSalaryDomain())
    .range([innerHeight, 0])
    .nice();

  boxLayers.root = boxSvg
    .append("g")
    .attr(
      "transform",
      `translate(${boxConfig.margin.left},${boxConfig.margin.top})`,
    );
  // One shared chart area supports both modes: the all-locations box plot and
  // the selected-location scatter plot.
  boxLayers.yGrid = boxLayers.root.append("g").attr("class", "grid y-grid");
  boxLayers.xGrid = boxLayers.root
    .append("g")
    .attr("class", "grid x-grid")
    .attr("transform", `translate(0,${innerHeight})`);
  boxLayers.boxes = boxLayers.root.append("g");
  boxLayers.scatter = boxLayers.root.append("g").attr("class", "scatter-layer");
  boxLayers.xAxis = boxLayers.root
    .append("g")
    .attr("class", "axis")
    .attr("transform", `translate(0,${innerHeight})`);
  boxLayers.yAxis = boxLayers.root.append("g").attr("class", "axis");
  boxLayers.message = boxLayers.root.append("g");

  boxSvg
    .append("text")
    .attr("class", "axis-label")
    .attr("x", boxConfig.margin.left + innerWidth / 2)
    .attr("y", boxConfig.height - 16)
    .attr("text-anchor", "middle")
    .text("Years of Experience");

  boxSvg
    .append("text")
    .attr("class", "axis-label")
    .attr(
      "transform",
      `translate(26, ${boxConfig.margin.top + innerHeight / 2}) rotate(-90)`,
    )
    .attr("text-anchor", "middle")
    .text("Annual Salary (USD)");
}

function updateAll() {
  updateMap();
  updateSelectionSummary();
  updateChart();
}

function updateFilterControls() {
  const filterConfig = getCurrentFilterConfig();
  const validValues = getValidFilterValues();

  if (
    state.selectedFilterValue !== ALL_VALUE &&
    !validValues.includes(state.selectedFilterValue)
  ) {
    state.selectedFilterValue = ALL_VALUE;
  }

  dom.filterTypeSelect.value = state.selectedFilterType;
  // Rebuild the value dropdown from the current location scope and currently
  // selected attribute type so only meaningful choices remain available.
  populateSelect(
    dom.filterValueSelect,
    validValues,
    filterConfig.allLabel,
    state.selectedFilterValue,
  );
  dom.resetCityButton.disabled =
    !state.selectedLocation &&
    state.selectedFilterType === DEFAULT_FILTER_TYPE &&
    state.selectedFilterValue === ALL_VALUE;
}

function updateMap() {
  const mapRows = getRowsForMap();
  const locationSummaries = summarizeLocations(mapRows);
  const remoteSummary =
    locationSummaries.find((d) => d.city === "Remote") || null;
  const plottedLocations = locationSummaries
    .filter((d) => d.city !== "Remote" && d.isMapped)
    .sort((a, b) => d3.descending(a.count, b.count))
    .map((d) => ({
      ...d,
      // Map markers now use a uniform dot radius so interaction is carried by
      // hover/selection styling rather than size encoding.
      baseRadius: MAP_DOT_RADIUS,
    }));

  state.mapSummaries = locationSummaries;
  state.remoteSummary = remoteSummary;

  const transition = mapSvg.transition().duration(650);

  const markerJoin = mapLayers.markers
    .selectAll(".location-marker")
    .data(plottedLocations, (d) => d.city)
    .join(
      (enter) => {
        const group = enter.append("g").attr("class", "location-marker");

        group
          .append("circle")
          .attr("class", "map-city")
          .attr("r", 0)
          .on("mouseenter", handleLocationTooltipEnter)
          .on("mousemove", handleTooltipMove)
          .on("mouseleave", hideTooltip)
          .on("click", (_, d) => toggleLocationSelection(d.city));

        // City labels are attached to the same marker groups so they move
        // with pan/zoom and stay visually tied to their dots.
        group
          .append("text")
          .attr("class", "city-label")
          .attr("x", 10)
          .attr("y", 3)
          .text((d) => d.city);

        return group;
      },
      (update) => update,
      (exit) => exit.transition(transition).style("opacity", 0).remove(),
    );

  markerJoin.sort((a, b) => d3.descending(a.count, b.count));

  markerJoin
    .transition(transition)
    .attr("transform", (d) => `translate(${d.x},${d.y})`)
    .style("opacity", 1);

  markerJoin
    .select("circle")
    .classed("selected", (d) => d.city === state.selectedLocation)
    .classed(
      "dimmed",
      (d) =>
        Boolean(state.selectedLocation) && d.city !== state.selectedLocation,
    )
    .transition(transition)
    .attr("r", (d) => d.baseRadius);

  markerJoin
    .select("text")
    .text((d) => d.city)
    .classed(
      "dimmed",
      (d) =>
        Boolean(state.selectedLocation) && d.city !== state.selectedLocation,
    );

  updateRemoteMarker(remoteSummary);
  updateMapStatus(locationSummaries, plottedLocations, remoteSummary);
  applyMapZoomStyles();
}

function updateRemoteMarker(remoteSummary) {
  const isSelected = state.selectedLocation === "Remote";
  const isDimmed = Boolean(state.selectedLocation) && !isSelected;

  // Remote lives in the same SVG window as the geography, but outside the
  // zoomed viewport, so it behaves like a location filter without pretending
  // to sit on a real-world coordinate.
  mapLayers.remote
    .style("pointer-events", remoteSummary ? "all" : "none")
    .classed("selected", isSelected)
    .classed("dimmed", isDimmed)
    .style("opacity", remoteSummary ? 1 : 0.35);
}

function updateMapStatus(locationSummaries, plottedLocations, remoteSummary) {
  const missingCities = locationSummaries
    .filter((d) => !d.isMapped && d.city !== "Remote")
    .map((d) => d.city);
  const filterSummary = getActiveFilterLabel();

  if (!locationSummaries.length) {
    dom.mapStatus.textContent = `No locations match the current map filter (${filterSummary}).`;
    return;
  }

  const mappedText = `Map currently plots ${plottedLocations.length} geographic locations`;
  const remoteText = remoteSummary
    ? "and includes Remote position at the bottom left corner."
    : "and no Remote postings match the current filter scope.";

  if (missingCities.length) {
    dom.mapStatus.textContent = `${mappedText} ${remoteText} Missing coordinates: ${missingCities.join(
      ", ",
    )}. Add or fix them in the cityCoordinates object in script.js if you want those locations on the map.`;
  } else {
    dom.mapStatus.textContent = `${mappedText} ${remoteText} `;
  }
}

function updateSelectionSummary() {
  const locationLabel = state.selectedLocation || "All locations";

  dom.summaryScope.textContent = locationLabel;
  // The lower summary line now mirrors the single active attribute filter
  // instead of listing category and industry together.
  dom.summaryDetail.textContent = getSelectionFilterSummary();
}

function updateChart() {
  const filteredRows = getFilteredData();
  const medianSalary = filteredRows.length
    ? d3.median(filteredRows, (d) => d.annualSalaryUsd)
    : null;
  const isScatter = shouldUseScatterPlot();
  const innerWidth = getBoxInnerWidth();
  const innerHeight = getBoxInnerHeight();
  const transition = boxSvg.transition().duration(650);

  // Scatter is reserved for the most specific city-level subsets: once a
  // location is selected and the active filter value is no longer "All".
  updateChartHeader(isScatter);
  dom.boxMetrics.innerHTML = [
    createStatLine("Postings", filteredRows.length.toLocaleString()),
    createStatLine(
      "Median salary",
      medianSalary == null ? "N/A" : formatCurrency(medianSalary),
    ),
  ].join("");

  xScale.domain(state.allExperienceLevels);
  yScale.domain(getSalaryDomain()).nice();

  boxLayers.yGrid
    .transition(transition)
    .call(d3.axisLeft(yScale).tickSize(-innerWidth).tickFormat(""))
    .call((group) => group.selectAll("line").attr("stroke-dasharray", "4 4"));

  // Vertical guide lines are drawn from the center of each discrete year band
  // so both the box plot and scatter plot stay aligned to years 1 through 15.
  boxLayers.xGrid
    .transition(transition)
    .call(d3.axisBottom(xScale).tickSize(-innerHeight).tickFormat(""))
    .call((group) => group.selectAll("line").attr("stroke-dasharray", "4 4"));

  boxLayers.xAxis
    .transition(transition)
    .call(d3.axisBottom(xScale).tickFormat((d) => d.toString()));

  boxLayers.yAxis
    .transition(transition)
    .call(d3.axisLeft(yScale).ticks(6).tickFormat(formatCurrencyCompact));

  if (isScatter) {
    renderScatterPlot(filteredRows, { innerWidth, innerHeight, transition });
    return;
  }

  renderBoxPlot(filteredRows, { innerWidth, innerHeight, transition });
}

function updateChartHeader(isScatter) {
  dom.boxPanelTitle.textContent = isScatter
    ? "Annual Salary Scatter Plot"
    : "Annual Salary Box Plot";
  dom.chartPanelHint.textContent = isScatter
    ? "Hover over points to see more details."
    : "Hover over the box plot and outliers to see more details.";
  boxSvg.attr(
    "aria-label",
    isScatter
      ? "Scatter plot of annual salary by years of experience"
      : "Box plot of annual salary by years of experience",
  );
}

function shouldUseScatterPlot() {
  return (
    Boolean(state.selectedLocation) && state.selectedFilterValue !== ALL_VALUE
  );
}

function renderBoxPlot(filteredRows, { innerWidth, innerHeight, transition }) {
  clearScatterLayer(transition);

  const boxStats = d3
    .groups(filteredRows, (d) => d.yearsOfExperience)
    .map(([yearsOfExperience, rows]) =>
      computeBoxStats(yearsOfExperience, rows),
    )
    .sort((a, b) => d3.ascending(a.experience, b.experience));
  const isEmpty = filteredRows.length === 0;
  const isSparse =
    !isEmpty &&
    (filteredRows.length < 2 || boxStats.every((stat) => stat.count < 2));
  const displayedStats = isSparse ? [] : boxStats;
  const boxWidth = Math.min(xScale.bandwidth() * 0.64, 44);

  const groups = boxLayers.boxes
    .selectAll(".box-group")
    .data(displayedStats, (d) => d.experience)
    .join(
      (enter) => {
        const group = enter.append("g").attr("class", "box-group");
        group.append("line").attr("class", "whisker-line upper-stem");
        group.append("line").attr("class", "whisker-line lower-stem");
        group.append("line").attr("class", "whisker-cap upper-cap");
        group.append("line").attr("class", "whisker-cap lower-cap");
        group.append("rect").attr("class", "box-rect");
        group.append("line").attr("class", "box-line median-line");
        group.append("g").attr("class", "outliers");
        group.append("rect").attr("class", "box-hit-area");
        return group;
      },
      (update) => update,
      (exit) => exit.transition(transition).style("opacity", 0).remove(),
    );

  groups
    .transition(transition)
    .attr(
      "transform",
      (d) => `translate(${xScale(d.experience) + xScale.bandwidth() / 2},0)`,
    )
    .style("opacity", 1);

  groups
    .select(".upper-stem")
    .transition(transition)
    .attr("x1", 0)
    .attr("x2", 0)
    .attr("y1", (d) => yScale(d.q3))
    .attr("y2", (d) => yScale(d.upperWhisker));

  groups
    .select(".lower-stem")
    .transition(transition)
    .attr("x1", 0)
    .attr("x2", 0)
    .attr("y1", (d) => yScale(d.q1))
    .attr("y2", (d) => yScale(d.lowerWhisker));

  groups
    .select(".upper-cap")
    .transition(transition)
    .attr("x1", -boxWidth / 3)
    .attr("x2", boxWidth / 3)
    .attr("y1", (d) => yScale(d.upperWhisker))
    .attr("y2", (d) => yScale(d.upperWhisker));

  groups
    .select(".lower-cap")
    .transition(transition)
    .attr("x1", -boxWidth / 3)
    .attr("x2", boxWidth / 3)
    .attr("y1", (d) => yScale(d.lowerWhisker))
    .attr("y2", (d) => yScale(d.lowerWhisker));

  groups
    .select(".box-rect")
    .transition(transition)
    .attr("x", -boxWidth / 2)
    .attr("width", boxWidth)
    .attr("y", (d) => yScale(d.q3))
    .attr("height", (d) => Math.max(1, yScale(d.q1) - yScale(d.q3)));

  groups
    .select(".median-line")
    .transition(transition)
    .attr("x1", -boxWidth / 2)
    .attr("x2", boxWidth / 2)
    .attr("y1", (d) => yScale(d.median))
    .attr("y2", (d) => yScale(d.median));

  groups
    .select(".box-hit-area")
    .attr("x", -boxWidth / 2 - 8)
    .attr("width", boxWidth + 16)
    .attr("y", (d) => yScale(d.upperWhisker) - 10)
    .attr("height", (d) =>
      Math.max(24, yScale(d.lowerWhisker) - yScale(d.upperWhisker) + 20),
    )
    .on("mouseenter", (event, datum) => showBoxTooltip(event, datum))
    .on("mousemove", handleTooltipMove)
    .on("mouseleave", hideTooltip);

  groups.each(function boxOutliers(datum) {
    const outlierJoin = d3
      .select(this)
      .select(".outliers")
      .selectAll("circle")
      .data(datum.outliers, (_, index) => `${datum.experience}-${index}`);

    outlierJoin
      .join(
        (enter) =>
          enter
            .append("circle")
            .attr("class", "outlier-point")
            .attr("r", 0)
            .attr("cx", 0)
            .attr("cy", (value) => yScale(value))
            .on("mouseenter", (event, value) =>
              showBoxTooltip(event, datum, value),
            )
            .on("mousemove", handleTooltipMove)
            .on("mouseleave", hideTooltip),
        (update) =>
          update
            .on("mouseenter", (event, value) =>
              showBoxTooltip(event, datum, value),
            )
            .on("mousemove", handleTooltipMove)
            .on("mouseleave", hideTooltip),
        (exit) => exit.transition(transition).attr("r", 0).remove(),
      )
      .transition(transition)
      .attr("cx", 0)
      .attr("cy", (value) => yScale(value))
      .attr("r", 3.8);
  });

  groups.select(".outliers").raise();

  updateChartMessage({
    innerWidth,
    innerHeight,
    title: isEmpty
      ? "No data for the current selection."
      : isSparse
        ? "Not enough data for the current selection."
        : null,
    note: isSparse
      ? "This combination is valid, but the sample is too sparse for a box plot."
      : null,
  });
}

function renderScatterPlot(
  filteredRows,
  { innerWidth, innerHeight, transition },
) {
  clearBoxPlotLayer(transition);

  const scatterRows = filteredRows.filter(
    (d) => xScale(d.yearsOfExperience) !== undefined,
  );

  const points = boxLayers.scatter
    .selectAll(".scatter-point")
    .data(scatterRows, (d) => d.rowId)
    .join(
      (enter) =>
        enter
          .append("circle")
          .attr("class", "scatter-point")
          .attr("cx", (d) => getScatterXPosition(d))
          .attr("cy", (d) => yScale(d.annualSalaryUsd))
          .attr("r", 0)
          .style("opacity", 0),
      (update) => update,
      (exit) =>
        exit.transition(transition).attr("r", 0).style("opacity", 0).remove(),
    );

  points
    .on("mouseenter", (event, datum) => showScatterTooltip(event, datum))
    .on("mousemove", handleTooltipMove)
    .on("mouseleave", hideTooltip)
    .transition(transition)
    .attr("cx", (d) => getScatterXPosition(d))
    .attr("cy", (d) => yScale(d.annualSalaryUsd))
    .attr("r", 4.1)
    .style("opacity", 0.62);

  updateChartMessage({
    innerWidth,
    innerHeight,
    title: scatterRows.length ? null : "No data for the current selection.",
    note: null,
  });
}

function clearBoxPlotLayer(transition) {
  boxLayers.boxes
    .selectAll(".box-group")
    .transition(transition)
    .style("opacity", 0)
    .remove();
}

function clearScatterLayer(transition) {
  boxLayers.scatter
    .selectAll(".scatter-point")
    .transition(transition)
    .attr("r", 0)
    .style("opacity", 0)
    .remove();
}

function updateChartMessage({
  innerWidth,
  innerHeight,
  title = null,
  note = null,
}) {
  boxLayers.message
    .selectAll(".empty-state")
    .data(title ? [title] : [])
    .join("text")
    .attr("class", "empty-state")
    .attr("x", innerWidth / 2)
    .attr("y", innerHeight / 2)
    .text((d) => d);

  boxLayers.message
    .selectAll(".chart-note")
    .data(note ? [note] : [])
    .join("text")
    .attr("class", "chart-note")
    .attr("x", innerWidth / 2)
    .attr("y", innerHeight / 2 + 24)
    .attr("text-anchor", "middle")
    .text((d) => d);
}

function getScatterXPosition(row) {
  // years_of_experience is discrete integer data, so points intentionally sit
  // exactly on the center of each year line rather than being jittered.
  return getExperienceBandCenter(row.yearsOfExperience);
}

function getExperienceBandCenter(year) {
  const bandStart = xScale(year);
  return bandStart + xScale.bandwidth() / 2;
}

function getRowsForMap() {
  return getScopedData({ location: ALL_VALUE });
}

function getFilteredData() {
  return getScopedData();
}

function getFilterConfig(filterType) {
  return FILTER_TYPES[filterType] || FILTER_TYPES[DEFAULT_FILTER_TYPE];
}

function getCurrentFilterConfig() {
  return getFilterConfig(state.selectedFilterType);
}

function getActiveFilterLabel() {
  const filterConfig = getCurrentFilterConfig();
  return state.selectedFilterValue === ALL_VALUE
    ? filterConfig.allLabel
    : `${filterConfig.label}: ${state.selectedFilterValue}`;
}

function getSelectionFilterSummary() {
  const filterConfig = getCurrentFilterConfig();
  return state.selectedFilterValue === ALL_VALUE
    ? `Filter: ${filterConfig.allLabel}`
    : `${filterConfig.label}: ${state.selectedFilterValue}`;
}

// Filtering now scopes the data by location first and then applies at most
// one optional attribute filter, based on the selected filter type/value.
function getScopedData({
  location = state.selectedLocation,
  filterType = state.selectedFilterType,
  filterValue = state.selectedFilterValue,
} = {}) {
  const filterConfig = getFilterConfig(filterType);

  return state.rows.filter(
    (d) =>
      matchesSelection(d.city, location) &&
      matchesSelection(d[filterConfig.rowKey], filterValue),
  );
}

function getValidFilterValues() {
  const filterConfig = getCurrentFilterConfig();

  return Array.from(
    new Set(
      getScopedData({ filterValue: ALL_VALUE })
        .map((d) => d[filterConfig.rowKey])
        .filter(Boolean),
    ),
  ).sort(d3.ascending);
}

function computeBoxStats(experience, rows) {
  const sortedSalaries = rows
    .map((row) => row.annualSalaryUsd)
    .sort(d3.ascending);
  const q1 = d3.quantileSorted(sortedSalaries, 0.25);
  const median = d3.quantileSorted(sortedSalaries, 0.5);
  const q3 = d3.quantileSorted(sortedSalaries, 0.75);
  const iqr = q3 - q1;
  const lowerFence = q1 - iqr * 1.5;
  const upperFence = q3 + iqr * 1.5;
  const inlierSalaries = sortedSalaries.filter(
    (salary) => salary >= lowerFence && salary <= upperFence,
  );

  return {
    experience,
    count: sortedSalaries.length,
    q1,
    median,
    q3,
    lowerWhisker: inlierSalaries.length
      ? d3.min(inlierSalaries)
      : sortedSalaries[0],
    upperWhisker: inlierSalaries.length
      ? d3.max(inlierSalaries)
      : sortedSalaries[sortedSalaries.length - 1],
    outliers: sortedSalaries.filter(
      (salary) => salary < lowerFence || salary > upperFence,
    ),
  };
}

function summarizeLocations(rows) {
  return d3
    .rollups(
      rows,
      (values) => ({
        country: values[0]?.country || "Unknown",
        count: values.length,
        medianSalary: d3.median(values, (d) => d.annualSalaryUsd),
        uniqueIndustries: new Set(values.map((d) => d.industry).filter(Boolean))
          .size,
      }),
      (d) => d.city,
    )
    .map(([city, summary]) => {
      const coordinates = cityCoordinates[city];
      const isMapped =
        coordinates &&
        Number.isFinite(coordinates.lat) &&
        Number.isFinite(coordinates.lon);
      const projected = isMapped
        ? mapProjection([coordinates.lon, coordinates.lat])
        : null;

      return {
        city,
        ...summary,
        isMapped,
        x: projected ? projected[0] : null,
        y: projected ? projected[1] : null,
      };
    })
    .sort((a, b) => d3.descending(a.count, b.count));
}

function toggleLocationSelection(location) {
  const nextLocation = state.selectedLocation === location ? null : location;
  state.selectedLocation = nextLocation;
  updateFilterControls();
  updateAll();

  if (!nextLocation || nextLocation === "Remote") {
    resetMapZoom();
    return;
  }

  const summary = state.mapSummaries.find(
    (d) => d.city === nextLocation && d.isMapped,
  );
  if (summary) {
    focusMapOnLocation(summary);
  }
}

function focusMapOnLocation(summary) {
  const transform = d3.zoomIdentity
    .translate(mapConfig.width / 2, mapConfig.height / 2)
    .scale(mapConfig.focusScale)
    .translate(-summary.x, -summary.y);

  mapSvg.transition().duration(750).call(mapZoom.transform, transform);
}

function resetMapZoom() {
  mapSvg.transition().duration(650).call(mapZoom.transform, d3.zoomIdentity);
}

function populateSelect(selectElement, values, allLabel, currentValue) {
  const options = [
    { value: ALL_VALUE, label: allLabel },
    ...values.map((value) => ({ value, label: value })),
  ];

  selectElement.innerHTML = options
    .map(
      (option) =>
        `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`,
    )
    .join("");

  selectElement.value = currentValue;
}

function handleLocationTooltipEnter(event, datum) {
  const html = [
    `<strong>${escapeHtml(datum.city)}</strong>`,
    createTooltipRow("Country", datum.country),
    createTooltipRow("Postings", datum.count.toLocaleString()),
    createTooltipRow("Median salary", formatCurrency(datum.medianSalary)),
  ].join("");

  dom.tooltip.html(html).style("opacity", 1).attr("aria-hidden", "false");
  handleTooltipMove(event);
}

function showScatterTooltip(event, datum) {
  const filterConfig = getCurrentFilterConfig();
  const rows = [
    // createTooltipRow("City", datum.city),
    createTooltipRow("Country", datum.country),
    createTooltipRow("Years of experience", datum.yearsOfExperience.toString()),
    createTooltipRow("Annual salary", formatCurrency(datum.annualSalaryUsd)),
  ];

  // if (datum[filterConfig.rowKey]) {
  //   rows.push(createTooltipRow(filterConfig.label, datum[filterConfig.rowKey]));
  // }

  dom.tooltip
    .html([`<strong>${escapeHtml(datum.city)}</strong>`, ...rows].join(""))
    .style("opacity", 1)
    .attr("aria-hidden", "false");
  handleTooltipMove(event);
}

// Box plot tooltip summarizes the hovered experience group, and if an outlier
// is hovered it appends that specific salary value to the same shared tooltip.
function showBoxTooltip(event, datum, outlierValue = null) {
  const rows = [
    createTooltipRow("Postings", datum.count.toLocaleString()),
    createTooltipRow("Median salary", formatCurrency(datum.median)),
  ];
  if (outlierValue == null) {
    rows.push(createTooltipRow("Q1", formatCurrency(datum.q1)));
    rows.push(createTooltipRow("Q3", formatCurrency(datum.q3)));
    rows.push(
      createTooltipRow("Whisker min", formatCurrency(datum.lowerWhisker)),
    );
    rows.push(
      createTooltipRow("Whisker max", formatCurrency(datum.upperWhisker)),
    );
  }

  if (outlierValue !== null) {
    rows.push(createTooltipRow("Outlier salary", formatCurrency(outlierValue)));
  }

  dom.tooltip
    .html([`<strong>${datum.experience} Years</strong>`, ...rows].join(""))
    .style("opacity", 1)
    .attr("aria-hidden", "false");
  handleTooltipMove(event);
}

function handleTooltipMove(event) {
  dom.tooltip
    .style("left", `${event.clientX}px`)
    .style("top", `${event.clientY}px`);
}

function hideTooltip() {
  dom.tooltip.style("opacity", 0).attr("aria-hidden", "true");
}

function showLoadError(error) {
  dom.summaryScope.textContent = "Visualization could not be loaded";
  dom.summaryDetail.textContent = "Filter: unavailable";
  dom.boxMetrics.innerHTML = createStatLine("Reason", "Check console");
  dom.mapStatus.textContent = error.message;

  boxSvg.selectAll("*").remove();
  boxSvg
    .append("text")
    .attr("class", "empty-state")
    .attr("x", boxConfig.width / 2)
    .attr("y", boxConfig.height / 2)
    .text("Unable to load the prototype data.");
}

function normalizeColumnName(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function matchesSelection(value, selectedValue) {
  return (
    selectedValue === ALL_VALUE ||
    selectedValue === null ||
    value === selectedValue
  );
}

function getBoxInnerWidth() {
  return boxConfig.width - boxConfig.margin.left - boxConfig.margin.right;
}

function getBoxInnerHeight() {
  return boxConfig.height - boxConfig.margin.top - boxConfig.margin.bottom;
}

function getSalaryDomain() {
  // A stable global salary scale makes transitions easier to compare across filters.
  const [minSalary, maxSalary] = state.globalSalaryExtent;
  const lowerBound = Math.max(0, minSalary * 0.92);
  const upperBound = maxSalary * 1.04;
  return [lowerBound, upperBound];
}

function formatCurrency(value) {
  return `$${d3.format(",.0f")(value)}`;
}

function formatCurrencyCompact(value) {
  return `$${d3.format(".3~s")(value).replace("G", "B")}`;
}

function createStatLine(label, value) {
  return `<div class="summary-stat-line"><span>${escapeHtml(label)}:</span> ${escapeHtml(
    value,
  )}</div>`;
}

function createTooltipRow(label, value) {
  return `<div class="tooltip-row"><span>${escapeHtml(label)}</span><span>${escapeHtml(
    value,
  )}</span></div>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
