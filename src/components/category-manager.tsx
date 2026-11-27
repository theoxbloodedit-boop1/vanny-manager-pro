"use client";

/**
 * ADR-0020 — ADVANCED CATEGORY MANAGER.
 *
 * Full CRUD on categories: create, rename, reorder (sort order), assign an
 * icon + accent color, delete. This replaces the inline "new category" input
 * in the catalog panel with a proper structured manager, giving the owner
 * full control over the catalogue's structure.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  GripVertical,
  Plus,
  Trash2,
  Tag,
  Check,
  X,
} from "lucide-react";
import {
  ApiErrorText,
  Button,
  Card,
  EmptyState,
  Input,
  Spinner,
} from "@/components/ui";
import { deleteJson, getJson, patchJson, postJson } from "@/lib/http-client";

interface Category {
  id: string;
  name: string;
  sortOrder: number;
  icon: string | null;
  color: string | null;
}

const COLOR_PRESETS = [
  "#0b5cff",
  "#e5252c",
  "#12833b",
  "#b45309",
  "#7c3aed",
  "#0e7490",
  "#6b7280",
  "#000000",
];

export function CategoryManager({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();

  const categories = useQuery({
    queryKey: ["categories"],
    queryFn: () => getJson<Category[]>("/api/categories"),
  });

  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(COLOR_PRESETS[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  // Inline edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState(COLOR_PRESETS[0]);

  async function add() {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    setError(undefined);
    try {
      const order = (categories.data?.length ?? 0) + 1;
      await postJson("/api/categories", { name, sortOrder: order, color: newColor });
      setNewName("");
      await qc.invalidateQueries({ queryKey: ["categories"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Création impossible");
    } finally {
      setBusy(false);
    }
  }

  function startEdit(c: Category) {
    setEditingId(c.id);
    setEditName(c.name);
    setEditColor(c.color ?? COLOR_PRESETS[0]);
  }

  async function saveEdit(c: Category) {
    setBusy(true);
    setError(undefined);
    try {
      await patchJson(`/api/categories/${c.id}`, {
        name: editName.trim(),
        color: editColor,
      });
      setEditingId(null);
      await qc.invalidateQueries({ queryKey: ["categories"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Mise à jour impossible");
    } finally {
      setBusy(false);
    }
  }

  async function remove(c: Category) {
    setBusy(true);
    setError(undefined);
    try {
      await deleteJson(`/api/categories/${c.id}`);
      await qc.invalidateQueries({ queryKey: ["categories"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Suppression impossible");
    } finally {
      setBusy(false);
    }
  }

  async function move(c: Category, dir: -1 | 1) {
    const list = categories.data ?? [];
    const idx = list.findIndex((x) => x.id === c.id);
    const swap = idx + dir;
    if (swap < 0 || swap >= list.length) return;
    // Reorder by swapping sort orders.
    const a = list[idx]!;
    const b = list[swap]!;
    setBusy(true);
    try {
      await patchJson(`/api/categories/${a.id}`, { sortOrder: b.sortOrder });
      await patchJson(`/api/categories/${b.id}`, { sortOrder: a.sortOrder });
      await qc.invalidateQueries({ queryKey: ["categories"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Réordonnancement impossible");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="Catégories"
      subtitle="Structurez votre catalogue. Glissez l'ordre, modifiez les noms et couleurs."
      icon={Tag}
    >
      {categories.isLoading ? (
        <div className="flex justify-center py-6">
          <Spinner />
        </div>
      ) : (categories.data?.length ?? 0) === 0 ? (
        <EmptyState icon={Tag} title="Aucune catégorie" hint="Créez votre première catégorie pour structurer vos produits." />
      ) : (
        <ul className="divide-y divide-border">
          {categories.data?.map((c, i) => (
            <li key={c.id} className="flex items-center gap-2 py-2.5">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full text-white" style={{ backgroundColor: c.color ?? "#6b7280" }}>
                <Tag className="size-3.5" aria-hidden />
              </span>
              {editingId === c.id ? (
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <Input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="min-h-10"
                  />
                  <div className="flex shrink-0 gap-1">
                    {COLOR_PRESETS.slice(0, 4).map((col) => (
                      <button
                        key={col}
                        type="button"
                        className={`size-6 rounded-full border-2 ${editColor === col ? "border-foreground" : "border-transparent"}`}
                        style={{ backgroundColor: col }}
                        onClick={() => setEditColor(col)}
                        aria-label={`Couleur ${col}`}
                      />
                    ))}
                  </div>
                  <Button variant="ghost" className="min-h-10 px-2" onClick={() => saveEdit(c)} disabled={busy}>
                    <Check className="size-4" aria-hidden />
                  </Button>
                  <Button variant="ghost" className="min-h-10 px-2" onClick={() => setEditingId(null)}>
                    <X className="size-4" aria-hidden />
                  </Button>
                </div>
              ) : (
                <>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{c.name}</p>
                    <p className="text-xs text-muted-foreground">Position {i + 1}</p>
                  </div>
                  {canEdit && (
                    <div className="flex shrink-0 items-center gap-1">
                      <Button variant="ghost" className="min-h-10 px-2" onClick={() => move(c, -1)} disabled={i === 0 || busy} title="Monter">
                        <GripVertical className="size-4 rotate-180" aria-hidden />
                      </Button>
                      <Button variant="ghost" className="min-h-10 px-2" onClick={() => move(c, 1)} disabled={i === (categories.data?.length ?? 1) - 1 || busy} title="Descendre">
                        <GripVertical className="size-4" aria-hidden />
                      </Button>
                      <Button variant="ghost" className="min-h-10 px-2" onClick={() => startEdit(c)} title="Modifier">
                        <Tag className="size-4" aria-hidden />
                      </Button>
                      <Button variant="ghost" className="min-h-10 px-2 text-accent" onClick={() => remove(c)} disabled={busy} title="Supprimer">
                        <Trash2 className="size-4" aria-hidden />
                      </Button>
                    </div>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <div className="mt-4 space-y-2 rounded-control bg-surface-inset p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Nouvelle catégorie…"
              className="min-h-10"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  add();
                }
              }}
            />
            <div className="flex shrink-0 gap-1">
              {COLOR_PRESETS.slice(0, 6).map((col) => (
                <button
                  key={col}
                  type="button"
                  className={`size-7 rounded-full border-2 ${newColor === col ? "border-foreground" : "border-transparent"}`}
                  style={{ backgroundColor: col }}
                  onClick={() => setNewColor(col)}
                  aria-label={`Couleur ${col}`}
                />
              ))}
            </div>
            <Button loading={busy} onClick={add} className="min-h-10 shrink-0">
              <Plus className="size-4" aria-hidden />
              Ajouter
            </Button>
          </div>
          <ApiErrorText error={error} />
        </div>
      )}
    </Card>
  );
}
