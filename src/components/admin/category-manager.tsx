"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2, Edit2, Check, X, Loader2, Image as ImageIcon } from "lucide-react";
import Image from "next/image";
import { createCategory, updateCategory, deleteCategory } from "@/app/actions/admin";

type Category = {
  id: string;
  name: string;
  slug: string;
  imageUrl: string | null;
};

export function CategoryManager({ initialCategories }: { initialCategories: Category[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  // Create form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newImageUrl, setNewImageUrl] = useState("");

  // Edit form state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editImageUrl, setEditImageUrl] = useState("");

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;

    start(async () => {
      const res = await createCategory({
        name: newName.trim(),
        imageUrl: newImageUrl.trim() || null,
      });

      if (res.ok) {
        toast.success("Category created successfully!");
        setNewName("");
        setNewImageUrl("");
        setShowAddForm(false);
        router.refresh();
      } else {
        toast.error(res.error || "Failed to create category");
      }
    });
  }

  async function handleUpdate(id: string) {
    if (!editName.trim()) return;

    start(async () => {
      const res = await updateCategory(id, {
        name: editName.trim(),
        imageUrl: editImageUrl.trim() || null,
      });

      if (res.ok) {
        toast.success("Category updated successfully!");
        setEditingId(null);
        router.refresh();
      } else {
        toast.error(res.error || "Failed to update category");
      }
    });
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Are you sure you want to delete the category "${name}"? Products in this category will remain, but the category listing will be removed.`)) {
      return;
    }

    start(async () => {
      const res = await deleteCategory(id);
      if (res.ok) {
        toast.success("Category deleted");
        router.refresh();
      } else {
        toast.error(res.error || "Failed to delete category");
      }
    });
  }

  function startEditing(cat: Category) {
    setEditingId(cat.id);
    setEditName(cat.name);
    setEditImageUrl(cat.imageUrl || "");
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-serif text-3xl">Categories</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage product categories dynamically
          </p>
        </div>
        <button
          onClick={() => setShowAddForm((v) => !v)}
          className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm text-primary-foreground hover:opacity-90 transition-opacity"
        >
          {showAddForm ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {showAddForm ? "Cancel" : "Add category"}
        </button>
      </div>

      {showAddForm && (
        <form onSubmit={handleCreate} className="rounded-2xl border border-border bg-card p-5 space-y-4 max-w-xl">
          <h3 className="font-serif text-lg font-medium">New Category</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
                Category Name
              </label>
              <input
                type="text"
                placeholder="e.g. Premium Hoodies"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="input h-10"
                required
              />
            </div>
            <div>
              <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
                Cover Image URL (Optional)
              </label>
              <input
                type="text"
                placeholder="/products/level7/..."
                value={newImageUrl}
                onChange={(e) => setNewImageUrl(e.target.value)}
                className="input h-10"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="submit"
              disabled={pending}
              className="inline-flex items-center gap-2 rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background disabled:opacity-50"
            >
              {pending && <Loader2 className="h-4 w-4 animate-spin" />}
              Save Category
            </button>
          </div>
        </form>
      )}

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="px-5 py-4 font-medium w-16">Image</th>
                <th className="px-5 py-4 font-medium">Name</th>
                <th className="px-5 py-4 font-medium">Slug</th>
                <th className="px-5 py-4 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {initialCategories.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-5 py-8 text-center text-muted-foreground">
                    No categories found. Add your first category using the button above.
                  </td>
                </tr>
              ) : (
                initialCategories.map((cat) => {
                  const isEditing = editingId === cat.id;

                  return (
                    <tr key={cat.id} className="hover:bg-muted/40 transition-colors">
                      <td className="px-5 py-3">
                        <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-muted flex items-center justify-center border border-border">
                          {cat.imageUrl ? (
                            <Image
                              src={cat.imageUrl}
                              alt={cat.name}
                              fill
                              sizes="48px"
                              className="object-cover"
                            />
                          ) : (
                            <ImageIcon className="h-5 w-5 text-muted-foreground/60" />
                          )}
                        </div>
                      </td>
                      <td className="px-5 py-3 font-medium">
                        {isEditing ? (
                          <input
                            type="text"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            className="input h-9 py-1 px-2.5 max-w-xs font-normal"
                          />
                        ) : (
                          cat.name
                        )}
                      </td>
                      <td className="px-5 py-3 text-muted-foreground">
                        {isEditing ? (
                          <span className="text-xs font-mono bg-muted/60 px-2 py-1 rounded">
                            Auto-generated from name
                          </span>
                        ) : (
                          <span className="font-mono text-xs">{cat.slug}</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right">
                        {isEditing ? (
                          <div className="flex justify-end gap-2">
                            <button
                              onClick={() => handleUpdate(cat.id)}
                              disabled={pending}
                              className="inline-flex items-center gap-1 rounded-full bg-success/15 px-3.5 py-1.5 text-xs font-medium text-success hover:bg-success/20 disabled:opacity-50"
                            >
                              {pending ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Check className="h-3 w-3" />
                              )}
                              Save
                            </button>
                            <button
                              onClick={() => setEditingId(null)}
                              className="inline-flex items-center gap-1 rounded-full bg-muted px-3.5 py-1.5 text-xs text-muted-foreground hover:bg-muted-hover"
                            >
                              <X className="h-3 w-3" />
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div className="flex justify-end gap-1.5">
                            <button
                              onClick={() => startEditing(cat)}
                              className="grid h-9 w-9 place-items-center rounded-full border border-border text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                              title="Edit"
                            >
                              <Edit2 className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={() => handleDelete(cat.id, cat.name)}
                              className="grid h-9 w-9 place-items-center rounded-full border border-border text-muted-foreground hover:bg-danger/10 hover:text-danger hover:border-danger/20 transition-colors"
                              title="Delete"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {editingId && (
        <div className="rounded-2xl border border-border bg-card p-5 max-w-xl space-y-4">
          <h3 className="font-serif text-lg font-medium">Edit Category Details</h3>
          <div>
            <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
              Category Image URL
            </label>
            <input
              type="text"
              value={editImageUrl}
              onChange={(e) => setEditImageUrl(e.target.value)}
              className="input h-10"
              placeholder="/products/level7/..."
            />
          </div>
          <div className="flex justify-end">
            <button
              onClick={() => handleUpdate(editingId)}
              disabled={pending}
              className="inline-flex items-center gap-2 rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background disabled:opacity-50"
            >
              {pending && <Loader2 className="h-4 w-4 animate-spin" />}
              Update Details
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
