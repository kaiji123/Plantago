import { AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";

ModuleRegistry.registerModules([AllCommunityModule]);

const theme = themeQuartz.withParams({
  accentColor: "#1f4d3a",
  headerBackgroundColor: "#f3efe4",
  fontFamily: "inherit",
  fontSize: 13,
  rowHeight: 40,
  headerHeight: 40,
  borderColor: "#e4dccb",
});

export default function Grid<T>({ rows, cols, height = 360, quickFilter }: { rows: T[]; cols: ColDef<T>[]; height?: number; quickFilter?: string }) {
  return (
    <div style={{ height, width: "100%" }}>
      <AgGridReact<T>
        theme={theme}
        rowData={rows}
        columnDefs={cols}
        // flex fills wide screens; minWidth makes the grid scroll sideways on narrow ones.
        defaultColDef={{ sortable: true, filter: true, resizable: true, flex: 1, minWidth: 120 }}
        tooltipShowDelay={300}
        quickFilterText={quickFilter}
        overlayNoRowsTemplate="<span style='color:#7a7466'>Nothing here yet</span>"
        animateRows
      />
    </div>
  );
}

export const moneyCol = (field: string, headerName: string): ColDef<any> => ({
  field,
  headerName,
  type: "rightAligned",
  filter: "agNumberColumnFilter",
  valueFormatter: (p) => (p.value == null ? "" : (p.value / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })),
});

export const dateCol = (field: string, headerName: string): ColDef<any> => ({
  field,
  headerName,
  sort: "desc",
  valueFormatter: (p) => (p.value ? new Date(p.value).toLocaleString() : ""),
});
