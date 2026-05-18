import { useList } from "../lib/hooks";
import { date } from "../lib/api";
import { Vehicle, Asset } from "../lib/types";
import { PageState, DataTable, Badge, Tabs } from "../components/ui";

export default function Fleet() {
  const vehicles = useList<Vehicle[]>("/vehicles");
  const assets = useList<Asset[]>("/assets");

  return (
    <Tabs
      tabs={[
        {
          label: `Vehicles (${vehicles.data?.length ?? 0})`,
          content: (
            <PageState loading={vehicles.isLoading} error={vehicles.error} empty={vehicles.data?.length === 0}>
              {vehicles.data && (
                <DataTable
                  rows={vehicles.data}
                  rowKey={(v) => v.id}
                  columns={[
                    { header: "Vehicle", cell: (v) => <span className="font-medium">{v.name}</span> },
                    { header: "Rego", cell: (v) => v.registration },
                    { header: "Make/Model", cell: (v) => `${v.make ?? ""} ${v.model ?? ""}` },
                    { header: "Year", cell: (v) => v.year ?? "—" },
                    { header: "Odometer", cell: (v) => `${v.odometer.toLocaleString()} km` },
                    { header: "Driver", cell: (v) => v.assignedEmployee ? `${v.assignedEmployee.firstName} ${v.assignedEmployee.lastName}` : "—" },
                    {
                      header: "Service Due",
                      cell: (v) => (
                        <span className={v.serviceDueSoon ? "font-medium text-amber-600" : ""}>
                          {date(v.serviceDueAt)}{v.serviceDueSoon && " ⚠"}
                        </span>
                      ),
                    },
                    {
                      header: "Rego Due",
                      cell: (v) => (
                        <span className={v.registrationDueSoon ? "font-medium text-amber-600" : ""}>
                          {date(v.registrationDueAt)}
                        </span>
                      ),
                    },
                  ]}
                />
              )}
            </PageState>
          ),
        },
        {
          label: `Assets (${assets.data?.length ?? 0})`,
          content: (
            <PageState loading={assets.isLoading} error={assets.error} empty={assets.data?.length === 0}>
              {assets.data && (
                <DataTable
                  rows={assets.data}
                  rowKey={(a) => a.id}
                  columns={[
                    { header: "Asset", cell: (a) => <span className="font-medium">{a.name}</span> },
                    { header: "Type", cell: (a) => a.assetType.replace(/_/g, " ") },
                    { header: "Serial", cell: (a) => a.serialNumber ?? "—" },
                    { header: "Status", cell: (a) => <Badge value={a.status} /> },
                    { header: "Assigned To", cell: (a) => a.assignedEmployee ? `${a.assignedEmployee.firstName} ${a.assignedEmployee.lastName}` : "—" },
                    { header: "Vehicle", cell: (a) => a.assignedVehicle?.name ?? "—" },
                    { header: "Service Due", cell: (a) => date(a.serviceDueAt) },
                  ]}
                />
              )}
            </PageState>
          ),
        },
      ]}
    />
  );
}
