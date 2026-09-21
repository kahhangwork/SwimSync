"use client";

// This business's swim-school locations.
//
// Replaces the free-text location that used to live on every class. A location
// is now an ENTITY (name, address, notes) the admin manages here, and each class
// points at one — so the list is picked from, filtered by, and shown to parents
// consistently, instead of a typo becoming a new "location".
//
// DELETE MEANS ARCHIVE. A location an ACTIVE class still uses cannot be removed
// (the database refuses it — this page's pre-check is only a friendlier
// message). Removing one that only RETIRED classes hold ARCHIVES it: it vanishes
// from this list and every picker, but the row is kept so those retired classes
// keep a valid location and reactivating one never breaks. The name frees up for
// reuse. See docs/plans/LOCATION_ENTITY_PLAN.md.

import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/Button";
import { useLocations } from "./domain/useLocations";
import { useLocationForm } from "./domain/useLocationForm";
import { LocationsTable } from "./ui/LocationsTable";
import { LocationFormModal } from "./ui/LocationFormModal";
import { RemoveLocationModal } from "./ui/RemoveLocationModal";

export default function LocationsPage() {
  const list = useLocations();
  const form = useLocationForm({
    locations: list.locations,
    setBusy: list.setBusy,
    setError: list.setError,
    load: list.load,
  });

  return (
    <div>
      <PageHeader
        title="Locations"
        subtitle="Your swim-school locations. Each class is set to one, on the Classes page."
      />

      <div className="mb-4">
        <Button onClick={form.openCreate}>Add location</Button>
      </div>

      {list.error &&
        !form.creating &&
        form.editing === null &&
        list.removing === null && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {list.error}
          </div>
        )}

      {list.loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : list.locations.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
          <p className="font-medium text-gray-900">No locations yet</p>
          <p className="mt-1 text-sm text-gray-500">
            Add the pools and centres you teach at. Every class is then set to one
            of them, and parents see where their child&rsquo;s class is held.
          </p>
        </div>
      ) : (
        <LocationsTable
          visible={list.visible}
          sort={list.sort}
          openEdit={form.openEdit}
          setRemoving={list.setRemoving}
        />
      )}

      <LocationFormModal
        open={form.creating || form.editing !== null}
        editing={form.editing}
        close={form.close}
        name={form.name}
        setName={form.setName}
        address={form.address}
        setAddress={form.setAddress}
        notes={form.notes}
        setNotes={form.setNotes}
        sortOrder={form.sortOrder}
        setSortOrder={form.setSortOrder}
        error={list.error}
        busy={list.busy}
        save={form.save}
      />

      <RemoveLocationModal
        removing={list.removing}
        setRemoving={list.setRemoving}
        busy={list.busy}
        remove={list.remove}
      />
    </div>
  );
}
