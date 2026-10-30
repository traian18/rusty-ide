/**
 * VfsRegistry — singleton that manages VfsInstance lifecycle.
 *
 * When a canvas tab is opened (or restored from a saved file),
 * call VfsRegistry.create(tabId) to get an isolated VfsInstance.
 * When a tab is closed, call VfsRegistry.destroy(tabId) to clean up.
 *
 * The registry ensures that each tabId maps to exactly one VfsInstance.
 * Calling get() for an unknown tabId will throw; use getOrCreate() for
 * lazy initialization.
 */

import { VfsInstance } from "./VfsInstance";

const instances = new Map<string, VfsInstance>();

export const VfsRegistry = {
  /**
   * Create a new VfsInstance for a tab.
   * Throws if an instance already exists for this tabId.
   *
   * @param tabId - The canvas tab ID
   * @returns The newly created VfsInstance
   */
  create(tabId?: string): VfsInstance {
    const tid = tabId || "global";
    if (instances.has(tid)) {
      console.warn(`[VfsRegistry] Instance already exists for tab: ${tid}, returning existing.`);
      return instances.get(tid)!;
    }
    const instance = new VfsInstance(tid);
    instances.set(tid, instance);
    console.log(`[VfsRegistry] Created VFS instance for tab: ${tid}`);
    return instance;
  },

  /**
   * Get the VfsInstance for a tab.
   * Throws if no instance exists — use getOrCreate() for lazy init.
   *
   * @param tabId - The canvas tab ID
   * @returns The existing VfsInstance
   * @throws If no instance exists for this tabId
   */
  get(tabId?: string): VfsInstance {
    const tid = tabId || "global";
    const instance = instances.get(tid);
    if (!instance) {
      throw new Error(`[VfsRegistry] No VFS instance for tab: ${tid}. Call create() or getOrCreate() first.`);
    }
    return instance;
  },

  /**
   * Get or create a VfsInstance for a tab.
   * If one already exists, returns it; otherwise creates a new one.
   * This is the recommended method for most consumers.
   *
   * @param tabId - The canvas tab ID
   * @returns The VfsInstance (existing or newly created)
   */
  getOrCreate(tabId?: string): VfsInstance {
    const tid = tabId || "global";
    if (instances.has(tid)) {
      return instances.get(tid)!;
    }
    return VfsRegistry.create(tid);
  },

  /**
   * Destroy the VfsInstance for a tab, removing it from the registry.
   * Does NOT clear the Rust-side VFS state (that requires a separate Rust command).
   *
   * @param tabId - The canvas tab ID to destroy
   */
  destroy(tabId?: string): void {
    const tid = tabId || "global";
    if (instances.delete(tid)) {
      console.log(`[VfsRegistry] Destroyed VFS instance for tab: ${tid}`);
    }
  },

  /**
   * Check whether a VfsInstance exists for a tab.
   *
   * @param tabId - The canvas tab ID
   * @returns true if an instance exists
   */
  has(tabId?: string): boolean {
    const tid = tabId || "global";
    return instances.has(tid);
  },
};
