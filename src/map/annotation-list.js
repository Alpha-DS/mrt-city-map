import L from "leaflet";
import { annotationsGroup } from "./annotate.js";
import { g } from "./globals.js";
import { showMeasurements } from "../utils/measure.js";
import { worldcoord, mapcoord } from "../utils/coord.js";
import GeoJSONReader from "jsts/org/locationtech/jts/io/GeoJSONReader.js";
import GeoJSONWriter from "jsts/org/locationtech/jts/io/GeoJSONWriter.js";
import BufferOp from "jsts/org/locationtech/jts/operation/buffer/BufferOp.js";

export class AnnotationList extends L.Control {
  constructor(map, options) {
    super(options);
    this.activeTab = "Line";
    this.setPosition("bottomleft").addTo(map);
  }

  onAdd() {
    const container = L.DomUtil.create("div", "annotation-list-control");
    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.disableScrollPropagation(container);

    const tabBar = L.DomUtil.create("div", "annotation-list-tabs", container);
    const tabIcons = {
      Line: "fas fa-minus",
      Polygon: "fas fa-draw-polygon",
      Rectangle: "far fa-square",
      Circle: "far fa-circle",
      Marker: "fas fa-map-marker-alt",
      Text: "fas fa-font",
    };

    for (const shape of [
      "Line",
      "Polygon",
      "Rectangle",
      "Circle",
      "Marker",
      "Text",
    ]) {
      const button = L.DomUtil.create("button", "", tabBar);
      button.title = shape;
      L.DomUtil.create("i", tabIcons[shape], button);
      button.dataset.shape = shape;
      if (shape === this.activeTab) button.classList.add("active");
      button.addEventListener("click", () => {
        this.activeTab = shape;
        this.keepTab = true;
        this.refresh();
      });
    }

    L.DomUtil.create("div", "annotation-list-content", container);

    this._container = container;
    this.refresh();
    return container;
  }

  onRemove() {}

  refresh() {
    const content = this._container?.querySelector(".annotation-list-content");
    if (!content) return;

    // Auto show/hide list if there are annotations on the map
    const hasAny = annotationsGroup
      .getLayers()
      .some((l) => g().map.hasLayer(l));
    this._container.style.display = hasAny ? "" : "none";
    if (!hasAny) return;

    // Auto switch to a different tab if the current one no longer has any annotations
    const currentHasLayers = annotationsGroup
      .getLayers()
      .some(
        (l) => l.options?.pmShape === this.activeTab && g().map.hasLayer(l),
      );

    if (!currentHasLayers && !this.keepTab) {
      const firstPopulated = [
        "Line",
        "Polygon",
        "Rectangle",
        "Circle",
        "Marker",
        "Text",
      ].find((s) =>
        annotationsGroup
          .getLayers()
          .some((l) => l.options?.pmShape === s && g().map.hasLayer(l)),
      );
      if (firstPopulated) this.activeTab = firstPopulated;
    }
    this.keepTab = false;

    this._container
      .querySelectorAll(".annotation-list-tabs button")
      .forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.shape === this.activeTab);
      });
    content.innerHTML = "";

    const layers = annotationsGroup
      .getLayers()
      .filter((l) => l.options?.pmShape === this.activeTab)
      .filter((l) => g().map.hasLayer(l));
    if (layers.length === 0) {
      content.innerHTML =
        "<div style='color:#aaa;padding:4px'>No annotations</div>";
      return;
    }
    layers.forEach((layer, i) => {
      const entry = L.DomUtil.create("div", "annotation-entry", content);
      const label = L.DomUtil.create("span", "", entry);
      label.textContent =
        layer.options.text ||
        layer.options?.annotationLabel ||
        `${this.activeTab} ${i + 1}`;
      label.style.cursor = "pointer";
      entry.style.cssText = "display:flex; align-items:center; gap:2px;";
      label.style.cssText =
        "cursor:pointer; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1; min-width:0;";

      // Single click to focus on annotation
      label.addEventListener("click", () => {
        if (layer.getBounds) {
          g().map.fitBounds(layer.getBounds(), { animate: true });
        } else if (layer.getLatLng) {
          g().map.setView(layer.getLatLng(), g().map.getZoom(), {
            animate: true,
          });
        }
      });

      // Double click to edit label
      label.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        const input = document.createElement("input");
        input.value = label.textContent;
        input.style.width = "100%";
        entry.replaceChild(input, label);
        input.focus();
        input.select();

        let committed = false;
        const commit = () => {
          if (committed) return;
          committed = true;
          label.textContent = input.value || label.textContent;
          layer.options.annotationLabel = label.textContent;
          if (input.parentNode === entry) entry.replaceChild(label, input);
        };

        let cancelled = false;

        input.addEventListener("blur", () => {
          if (!cancelled) commit();
        });

        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") {
            cancelled = true;
            entry.replaceChild(label, input);
          }
        });
      });

      // Stroke color picker
      if (!(layer.options.pmShape === "Marker" && !layer.options.textMarker)) {
        const currentStroke = layer.options.textMarker
          ? (layer.options.textColor ?? "#000000")
          : (layer.options.color ?? "#3388ff");

        const strokeLabel = L.DomUtil.create("label", "", entry);
        strokeLabel.title = layer.options.textMarker
          ? "Font color"
          : "Stroke color";
        strokeLabel.style.cursor = "pointer";

        const strokeIcon = L.DomUtil.create("i", "", strokeLabel);
        strokeIcon.style.cssText = `display:inline-block; width:18px; height:3px; background:${currentStroke}; border-radius:2px; vertical-align:middle; margin:0 2px; outline:1px solid #888;`;

        const strokeInput = L.DomUtil.create("input", "", strokeLabel);
        strokeInput.type = "color";
        strokeInput.value = currentStroke;
        strokeInput.style.cssText =
          "opacity:0; width:0; height:0; position:absolute;";

        strokeInput.addEventListener("input", () => {
          strokeIcon.style.background = strokeInput.value;
          if (layer.options.textMarker) {
            layer.pm.getElement().style.color = strokeInput.value;
            layer.options.textColor = strokeInput.value;
          } else layer.setStyle({ color: strokeInput.value });
        });
      }

      // Fill color picker
      if (
        layer.options.pmShape !== "Line" &&
        !(layer.options.pmShape === "Marker" && !layer.options.textMarker)
      ) {
        const currentFill = layer.options.textMarker
          ? layer.pm.getElement().style.backgroundColor
          : (layer.options.fillColor ?? "#3388ff");

        const fillLabel = L.DomUtil.create("label", "", entry);
        fillLabel.title = layer.options.textMarker
          ? "Background color"
          : "Fill color";
        fillLabel.style.cursor = "pointer";

        const fillIcon = L.DomUtil.create("i", "", fillLabel);
        fillIcon.style.cssText = `display:inline-block; width:18px; height:14px; background:${currentFill || "transparent"}; border-radius:3px; border:1px solid #888; vertical-align:middle; margin:0 2px;`;

        const fillInput = L.DomUtil.create("input", "", fillLabel);
        fillInput.type = "color";
        fillInput.value = currentFill?.slice(0, 7) ?? "#3388ff";
        fillInput.style.cssText =
          "opacity:0; width:0; height:0; position:absolute;";

        fillInput.addEventListener("input", () => {
          fillIcon.style.background = fillInput.value;
          if (layer.options.textMarker)
            layer.pm.getElement().style.backgroundColor = fillInput.value;
          else layer.setStyle({ fillColor: fillInput.value });
        });
        if (layer.options.textMarker) {
          const backgroundToggle = L.DomUtil.create("button", "", entry);
          L.DomUtil.create("i", "fas fa-fill", backgroundToggle);
          backgroundToggle.title = "Toggle background";

          const computedBackground = getComputedStyle(
            layer.pm.getElement(),
          ).backgroundColor;
          const hasBackground =
            computedBackground &&
            computedBackground !== "rgba(0, 0, 0, 0)" &&
            computedBackground !== "transparent";
          if (!hasBackground) backgroundToggle.classList.add("inactive");
          backgroundToggle.addEventListener("click", () => {
            const element = layer.pm.getElement();
            const computedBg = getComputedStyle(element).backgroundColor;
            const isTransparent =
              !computedBg ||
              computedBg === "rgba(0, 0, 0, 0)" ||
              computedBg === "transparent";

            if (!isTransparent) {
              layer.options._savedBg = computedBg;
              element.style.backgroundColor = "transparent";
              backgroundToggle.classList.add("inactive");
              fillIcon.style.background = "transparent";
            } else {
              const restore = layer.options._savedBg ?? fillInput.value;
              element.style.backgroundColor = restore;
              backgroundToggle.classList.remove("inactive");
              fillIcon.style.background = restore;
            }
          });
        }
      }

      // Visibility toggle
      const visibilityButton = L.DomUtil.create("button", "", entry);
      const visibilityIcon = L.DomUtil.create(
        "i",
        "fas fa-eye",
        visibilityButton,
      );
      visibilityButton.addEventListener("click", () => {
        const visible = !layer.options.hidden;
        this.toggleVisibility(layer, !visible);
        visibilityIcon.className = visible ? "fas fa-eye-slash" : "fas fa-eye";
      });
      if (layer.options.hidden) visibilityIcon.className = "fas fa-eye-slash";

      // Measurement toggle button
      if (!(layer instanceof L.Marker)) {
        const measureButton = L.DomUtil.create("button", "", entry);
        L.DomUtil.create("i", "fas fa-ruler", measureButton);
        measureButton.style.cursor = "pointer";
        if (layer.options.hideMeasurements)
          measureButton.classList.add("inactive");

        measureButton.addEventListener("click", () => {
          if (layer.options.hideMeasurements) {
            showMeasurements(layer);
            layer.options.hideMeasurements = false;
            measureButton.classList.remove("inactive");
          } else {
            layer.hideMeasurements();
            layer.options.hideMeasurements = true;
            measureButton.classList.add("inactive");
          }
        });
      }

      // 300/500 block radius toggle button
      if (layer.options.pmShape !== "Marker" &&
        layer.options.pmShape !== "Text") {
        const radiusButton = L.DomUtil.create("button", "", entry);
        L.DomUtil.create("i", "fas fa-bullseye", radiusButton);
        radiusButton.style.cursor = "pointer";
        if (
          !layer.options.radiusOverlay ||
          !g().map.hasLayer(layer.options.radiusOverlay)
        )
          radiusButton.classList.add("inactive");

        radiusButton.addEventListener("click", () => {
          toggleRadiusOverlay(layer);
          radiusButton.classList.toggle(
            "inactive",
            !g().map.hasLayer(layer.options.radiusOverlay),
          );
        });
      }
    });
  }

  toggleVisibility(layer, visible) {
    layer.options.hidden = !visible;
    if (visible) {
      g().map.addLayer(layer);
      if (!(layer instanceof L.Marker) && !layer.options.hideMeasurements) {
        showMeasurements(layer);
      }
      if (
        layer.options.radiusOverlay &&
        layer.options.radiusOverlayWasVisible
      ) {
        g().map.addLayer(layer.options.radiusOverlay);
      }
    } else {
      layer.options.radiusOverlayWasVisible =
        layer.options.radiusOverlay &&
        g().map.hasLayer(layer.options.radiusOverlay);
      g().map.removeLayer(layer);
    }
  }
}

function createRadiusOverlay(layer) {
  const reader = new GeoJSONReader();
  const writer = new GeoJSONWriter();
  const remap = (coords) => {
    if (Array.isArray(coords[0])) return coords.map(remap);
    const [x, y] = worldcoord([coords[1], coords[0]]);
    return [x, y];
  };
  const unmap = (coords) => {
    if (Array.isArray(coords[0])) return coords.map(unmap);
    const [lat, lng] = mapcoord([coords[0], coords[1]]);
    return [lng, lat];
  };
  const geojson = layer.toGeoJSON();
  let buf300 = 300;
  let buf500 = 500;
  if (layer instanceof L.Circle) {
    const worldRadius = layer.getRadius() * 64;
    buf300 += worldRadius;
    buf500 += worldRadius;
  }
  const worldGeo = {
    ...geojson,
    geometry: {
      ...geojson.geometry,
      coordinates: remap(geojson.geometry.coordinates),
    },
  };
  let jstsGeom = reader.read(worldGeo.geometry);
  const make = (amount, color) => {
    const buffered = BufferOp.bufferOp(jstsGeom, amount, 16);
    const result = writer.write(buffered);
    return L.geoJSON(
      {
        type: "Feature",
        geometry: {
          ...result,
          coordinates: unmap(result.coordinates),
        },
      },
      {
        style: { color, fillOpacity: 0.1, weight: 2 },
        interactive: false,
        pmIgnore: true,
      },
    );
  };
  const overlayGroup = L.featureGroup([
    make(buf500, "yellow"),
    make(buf300, "red"),
  ]);
  layer.options.radiusOverlay = overlayGroup;
  if (!layer.options.radiusEventsbound) {
    layer.options.radiusEventsbound = true;

    layer.on("remove", () => {
      layer.options.radiusOverlay?.remove();
    });
    layer.on("add", () => {
      if (
        layer.options.radiusOverlay &&
        !layer.options.hidden &&
        layer.options.radiusOverlayVisible
      ) {
        g().map.addLayer(layer.options.radiusOverlay);
      }
    });
    layer.on(
      "pm:markerdragend pm:vertexadded pm:vertexremoved pm:dragend",
      () => {
        const wasVisible =
          layer.options.radiusOverlay &&
          g().map.hasLayer(layer.options.radiusOverlay);
        layer.options.radiusOverlay?.remove();
        layer.options.radiusOverlay = null;
        if (wasVisible) {
          createRadiusOverlay(layer);
          g().map.addLayer(layer.options.radiusOverlay);
        } else {
          createRadiusOverlay(layer);
        }
      },
    );
  }
}

function toggleRadiusOverlay(layer) {
  if (
    layer.options.radiusOverlay &&
    g().map.hasLayer(layer.options.radiusOverlay)
  ) {
    g().map.removeLayer(layer.options.radiusOverlay);
    layer.options.radiusOverlayVisible = false;
  } else {
    if (!layer.options.radiusOverlay) createRadiusOverlay(layer);
    g().map.addLayer(layer.options.radiusOverlay);
    layer.options.radiusOverlayVisible = true;
  }
}
