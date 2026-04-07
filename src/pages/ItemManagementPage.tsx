import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Search,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Boxes,
  Plus,
  Pencil,
  Trash2,
  Check,
  X,
  CheckCircle2,
  Clock,
  AlertCircle,
  DoorOpen,
  Square,
  Wrench,
  Building2,
  Tag,
  Ban,
  ShieldOff,
  ArrowLeftRight,
  ToggleLeft,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import {
  getItemTypes,
  getItemTypeFields,
  upsertItemTypeField,
  deleteItemTypeField,
  deleteItemType,
  getFieldDefinitions,
  updateFieldDefinition,
  updateFieldDefinitionStatus,
  getManufacturerFieldLabels,
  upsertManufacturerFieldLabel,
  deleteManufacturerFieldLabel,
  updateManufacturerFieldLabelStatus,
  moveManufacturerFieldLabel,
  getBlockedFieldLabels,
  addBlockedFieldLabel,
  removeBlockedFieldLabel,
  renameItemType,
  createOrApproveFieldDefinition,
  getHardwareCatalog,
  createHardwareCatalogItem,
  updateHardwareCatalogItem,
  deleteHardwareCatalogItem,
} from '@/lib/estimates-api';
import { listCompanies, createCompany } from '@/lib/companies-api';
import { useAuth } from '@/contexts/AuthContext';
import type {
  ItemType,
  ItemCategory,
  ItemTypeField,
  FieldDefinition,
  FieldDefinitionStatus,
  FieldValueType,
  ManufacturerFieldLabel,
  BlockedFieldLabel,
  Company,
  HardwareCatalogItem,
  HardwareSubcategory,
} from '@/types';

const CATEGORIES: { key: ItemCategory; label: string; icon: typeof DoorOpen }[] = [
  { key: 'doors', label: 'Doors', icon: DoorOpen },
  { key: 'frames', label: 'Frames', icon: Square },
  { key: 'hardware', label: 'Hardware', icon: Wrench },
];

type HardwareSubtab = HardwareSubcategory | 'discovered';

const HARDWARE_SUBCATEGORIES: { key: HardwareSubcategory; label: string }[] = [
  { key: 'swing_it', label: 'Swing It' },
  { key: 'close_it', label: 'Close It' },
  { key: 'latch_it', label: 'Latch It' },
  { key: 'protect_it', label: 'Protect It' },
];

const SUBCATEGORY_LABEL: Record<HardwareSubcategory, string> = {
  swing_it: 'Swing It',
  close_it: 'Close It',
  latch_it: 'Latch It',
  protect_it: 'Protect It',
};

export default function ItemManagementPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [itemTypes, setItemTypes] = useState<ItemType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<ItemCategory>('doors');
  const [expandedCodes, setExpandedCodes] = useState<Set<string>>(new Set());
  const [itemTypeFieldsMap, setItemTypeFieldsMap] = useState<Map<string, ItemTypeField[]>>(new Map());
  const [fieldsLoading, setFieldsLoading] = useState<Set<string>>(new Set());
  const [allFieldDefs, setAllFieldDefs] = useState<FieldDefinition[]>([]);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Alias state
  const [expandedFieldAliases, setExpandedFieldAliases] = useState<Set<string>>(new Set());
  const [aliasesMap, setAliasesMap] = useState<Map<string, ManufacturerFieldLabel[]>>(new Map());
  const [aliasesLoading, setAliasesLoading] = useState<Set<string>>(new Set());
  const [manufacturers, setManufacturers] = useState<Pick<Company, 'id' | 'name'>[]>([]);
  const [addAliasTarget, setAddAliasTarget] = useState<{ fieldDefId: string; fieldLabel: string } | null>(null);
  const [newAliasManufacturerId, setNewAliasManufacturerId] = useState<string>('');
  const [newAliasLabel, setNewAliasLabel] = useState('');
  const [addAliasLoading, setAddAliasLoading] = useState(false);
  const [showNewManufacturer, setShowNewManufacturer] = useState(false);
  const [newManufacturerName, setNewManufacturerName] = useState('');
  const [newManufacturerLoading, setNewManufacturerLoading] = useState(false);

  const [moveAliasTarget, setMoveAliasTarget] = useState<{ alias: ManufacturerFieldLabel; currentFieldDefId: string } | null>(null);
  const [moveAliasNewFieldDefId, setMoveAliasNewFieldDefId] = useState('');
  const [moveAliasLoading, setMoveAliasLoading] = useState(false);

  const [addFieldTarget, setAddFieldTarget] = useState<string | null>(null);
  const [selectedFieldDefId, setSelectedFieldDefId] = useState<string>('');
  const [addFieldMode, setAddFieldMode] = useState<'select' | 'create'>('select');
  const [newFieldLabel, setNewFieldLabel] = useState('');
  const [newFieldKey, setNewFieldKey] = useState('');
  const [newFieldValueType, setNewFieldValueType] = useState<FieldValueType>('string');

  const [deleteTarget, setDeleteTarget] = useState<{
    field: ItemTypeField;
    canonicalCode: string;
  } | null>(null);

  const [deleteItemTarget, setDeleteItemTarget] = useState<ItemType | null>(null);
  const [deleteItemLoading, setDeleteItemLoading] = useState(false);

  const [renameTarget, setRenameTarget] = useState<ItemType | null>(null);
  const [renameLabel, setRenameLabel] = useState('');
  const [renameLoading, setRenameLoading] = useState(false);

  const [editTarget, setEditTarget] = useState<ItemTypeField | null>(null);
  const [editLabel, setEditLabel] = useState('');

  const [blockedLabels, setBlockedLabels] = useState<BlockedFieldLabel[]>([]);
  const [blockedLabelsLoading, setBlockedLabelsLoading] = useState(false);
  const [unblockLoading, setUnblockLoading] = useState<string | null>(null);

  // Hardware catalog management state
  const [catalogItems, setCatalogItems] = useState<HardwareCatalogItem[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [hardwareSubtab, setHardwareSubtab] = useState<HardwareSubtab>('swing_it');
  const [catalogDialogMode, setCatalogDialogMode] = useState<'add' | 'edit' | null>(null);
  const [catalogEditTarget, setCatalogEditTarget] = useState<HardwareCatalogItem | null>(null);
  const [catalogForm, setCatalogForm] = useState({
    name: '',
    canonicalCode: '',
    subcategory: 'swing_it' as HardwareSubcategory,
    description: '',
    active: true,
    sortOrder: 0,
  });
  const [catalogFormLoading, setCatalogFormLoading] = useState(false);
  const [catalogDeleteTarget, setCatalogDeleteTarget] = useState<HardwareCatalogItem | null>(null);
  const [catalogDeleteLoading, setCatalogDeleteLoading] = useState(false);

  const loadingCodesRef = useRef(new Set<string>());
  const { toast } = useToast();

  const fetchItemTypes = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setItemTypeFieldsMap(new Map());
      loadingCodesRef.current = new Set();
      const data = await getItemTypes();
      setItemTypes(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load item types');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchBlockedLabels = useCallback(async () => {
    setBlockedLabelsLoading(true);
    try {
      const data = await getBlockedFieldLabels();
      setBlockedLabels(data);
    } catch {
      // best-effort
    } finally {
      setBlockedLabelsLoading(false);
    }
  }, []);

  const fetchCatalog = useCallback(async () => {
    setCatalogLoading(true);
    try {
      const data = await getHardwareCatalog(undefined, { includeInactive: true });
      setCatalogItems(data);
    } catch {
      // best-effort
    } finally {
      setCatalogLoading(false);
    }
  }, []);

  const openAddCatalogDialog = (defaultSubcategory: HardwareSubcategory) => {
    const nextOrder = catalogItems.filter((i) => i.subcategory === defaultSubcategory).length;
    setCatalogEditTarget(null);
    setCatalogForm({
      name: '',
      canonicalCode: '',
      subcategory: defaultSubcategory,
      description: '',
      active: true,
      sortOrder: nextOrder,
    });
    setCatalogDialogMode('add');
  };

  const openEditCatalogDialog = (item: HardwareCatalogItem) => {
    setCatalogEditTarget(item);
    setCatalogForm({
      name: item.name,
      canonicalCode: item.canonicalCode,
      subcategory: item.subcategory,
      description: item.description ?? '',
      active: item.active,
      sortOrder: item.sortOrder,
    });
    setCatalogDialogMode('edit');
  };

  const handleCatalogSave = async () => {
    if (!catalogForm.name.trim() || !catalogForm.canonicalCode.trim()) return;
    try {
      setCatalogFormLoading(true);
      if (catalogDialogMode === 'add') {
        const created = await createHardwareCatalogItem({
          name: catalogForm.name.trim(),
          canonicalCode: catalogForm.canonicalCode.trim(),
          subcategory: catalogForm.subcategory,
          description: catalogForm.description.trim() || undefined,
          active: catalogForm.active,
          sortOrder: catalogForm.sortOrder,
        });
        setCatalogItems((prev) =>
          [...prev, created].sort((a, b) => a.sortOrder - b.sortOrder)
        );
      } else if (catalogEditTarget) {
        const updated = await updateHardwareCatalogItem(catalogEditTarget.id, {
          name: catalogForm.name.trim(),
          canonicalCode: catalogForm.canonicalCode.trim(),
          subcategory: catalogForm.subcategory,
          description: catalogForm.description.trim() || undefined,
          active: catalogForm.active,
          sortOrder: catalogForm.sortOrder,
        });
        setCatalogItems((prev) =>
          prev.map((i) => (i.id === updated.id ? updated : i))
        );
      }
      toast({
        title: catalogDialogMode === 'add' ? 'Item added' : 'Item updated',
        description: `"${catalogForm.name.trim()}" has been ${catalogDialogMode === 'add' ? 'added to' : 'updated in'} the catalog.`,
      });
      setCatalogDialogMode(null);
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to save catalog item',
        variant: 'destructive',
      });
    } finally {
      setCatalogFormLoading(false);
    }
  };

  const handleCatalogDelete = async () => {
    if (!catalogDeleteTarget) return;
    try {
      setCatalogDeleteLoading(true);
      await deleteHardwareCatalogItem(catalogDeleteTarget.id);
      setCatalogItems((prev) => prev.filter((i) => i.id !== catalogDeleteTarget.id));
      toast({
        title: 'Item deleted',
        description: `"${catalogDeleteTarget.name}" has been removed from the catalog.`,
      });
      setCatalogDeleteTarget(null);
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to delete catalog item',
        variant: 'destructive',
      });
    } finally {
      setCatalogDeleteLoading(false);
    }
  };

  useEffect(() => {
    fetchItemTypes();
    fetchBlockedLabels();
    fetchCatalog();
    getFieldDefinitions()
      .then(setAllFieldDefs)
      .catch(() => {/* best-effort */});
    listCompanies()
      .then((companies) =>
        setManufacturers(
          companies
            .filter((c) => c.companyType === 'manufacturer' || c.companyType === 'both')
            .map((c) => ({ id: c.id, name: c.name }))
        )
      )
      .catch(() => {/* best-effort */});
  }, [fetchItemTypes, fetchBlockedLabels, fetchCatalog]);

  const loadFieldsForCode = useCallback(async (canonicalCode: string, allCodes: string[]) => {
    if (loadingCodesRef.current.has(canonicalCode)) return;
    loadingCodesRef.current.add(canonicalCode);
    setFieldsLoading((prev) => new Set(prev).add(canonicalCode));
    try {
      const fields = await getItemTypeFields(allCodes);
      setItemTypeFieldsMap((prev) => new Map(prev).set(canonicalCode, fields));
    } catch (err) {
      loadingCodesRef.current.delete(canonicalCode);
      toast({
        title: 'Error loading fields',
        description: err instanceof Error ? err.message : 'Failed to load fields',
        variant: 'destructive',
      });
    } finally {
      setFieldsLoading((prev) => {
        const next = new Set(prev);
        next.delete(canonicalCode);
        return next;
      });
    }
  }, [toast]);

  const toggleExpand = (item: ItemType) => {
    const { canonicalCode, canonicalCodes } = item;
    if (expandedCodes.has(canonicalCode)) {
      setExpandedCodes((prev) => {
        const next = new Set(prev);
        next.delete(canonicalCode);
        return next;
      });
    } else {
      setExpandedCodes((prev) => new Set(prev).add(canonicalCode));
      if (!itemTypeFieldsMap.has(canonicalCode)) {
        loadFieldsForCode(canonicalCode, canonicalCodes);
      }
    }
  };

  const toggleFieldAliases = async (fieldTypeFieldId: string, fieldDefId: string) => {
    if (expandedFieldAliases.has(fieldTypeFieldId)) {
      setExpandedFieldAliases((prev) => {
        const next = new Set(prev);
        next.delete(fieldTypeFieldId);
        return next;
      });
      return;
    }
    setExpandedFieldAliases((prev) => new Set(prev).add(fieldTypeFieldId));
    if (!aliasesMap.has(fieldDefId)) {
      setAliasesLoading((prev) => new Set(prev).add(fieldDefId));
      try {
        const aliases = await getManufacturerFieldLabels(fieldDefId);
        setAliasesMap((prev) => new Map(prev).set(fieldDefId, aliases));
      } catch (err) {
        toast({
          title: 'Error loading aliases',
          description: err instanceof Error ? err.message : 'Failed to load manufacturer aliases',
          variant: 'destructive',
        });
      } finally {
        setAliasesLoading((prev) => {
          const next = new Set(prev);
          next.delete(fieldDefId);
          return next;
        });
      }
    }
  };

  const handleDeleteAlias = async (alias: ManufacturerFieldLabel, fieldDefId: string) => {
    try {
      setActionLoading(`alias-${alias.id}`);
      await deleteManufacturerFieldLabel(alias.id);
      setAliasesMap((prev) => {
        const existing = prev.get(fieldDefId) ?? [];
        return new Map(prev).set(fieldDefId, existing.filter((a) => a.id !== alias.id));
      });
      const blocked = await addBlockedFieldLabel({
        fieldLabel: alias.manufacturerFieldLabel,
        fieldDefinitionId: alias.fieldDefinitionId,
      });
      setBlockedLabels((prev) =>
        prev.some((b) => b.id === blocked.id) ? prev : [blocked, ...prev]
      );
      toast({
        title: 'Alias removed & blocked',
        description: `"${alias.manufacturerFieldLabel}" has been added to the blocked list.`,
      });
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to remove alias',
        variant: 'destructive',
      });
    } finally {
      setActionLoading(null);
    }
  };

  const handleApproveAlias = async (alias: ManufacturerFieldLabel, fieldDefId: string) => {
    try {
      setActionLoading(`alias-${alias.id}`);
      const updated = await updateManufacturerFieldLabelStatus(alias.id, 'approved');
      setAliasesMap((prev) => {
        const existing = prev.get(fieldDefId) ?? [];
        return new Map(prev).set(fieldDefId, existing.map((a) => (a.id === alias.id ? updated : a)));
      });
      toast({ title: 'Alias approved', description: `"${alias.manufacturerFieldLabel}" is now approved.` });
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to approve alias',
        variant: 'destructive',
      });
    } finally {
      setActionLoading(null);
    }
  };

  const openMoveAlias = (alias: ManufacturerFieldLabel, currentFieldDefId: string) => {
    setMoveAliasTarget({ alias, currentFieldDefId });
    setMoveAliasNewFieldDefId('');
  };

  const handleMoveAlias = async () => {
    if (!moveAliasTarget || !moveAliasNewFieldDefId) return;
    const { alias, currentFieldDefId } = moveAliasTarget;
    try {
      setMoveAliasLoading(true);
      const updated = await moveManufacturerFieldLabel(alias.id, moveAliasNewFieldDefId);
      setAliasesMap((prev) => {
        const next = new Map(prev);
        const currentList = next.get(currentFieldDefId) ?? [];
        next.set(currentFieldDefId, currentList.filter((a) => a.id !== alias.id));
        const newList = next.get(moveAliasNewFieldDefId) ?? [];
        next.set(moveAliasNewFieldDefId, [...newList, updated]);
        return next;
      });
      toast({
        title: 'Alias moved',
        description: `"${alias.manufacturerFieldLabel}" has been reassigned to the new field.`,
      });
      setMoveAliasTarget(null);
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to move alias',
        variant: 'destructive',
      });
    } finally {
      setMoveAliasLoading(false);
    }
  };

  const openAddAlias = (fieldDefId: string, fieldLabel: string) => {
    setAddAliasTarget({ fieldDefId, fieldLabel });
    setNewAliasManufacturerId('');
    setNewAliasLabel('');
    setShowNewManufacturer(false);
    setNewManufacturerName('');
  };

  const handleCreateManufacturer = async () => {
    if (!newManufacturerName.trim()) return;
    try {
      setNewManufacturerLoading(true);
      const created = await createCompany({
        name: newManufacturerName.trim(),
        companyType: 'manufacturer',
      });
      setManufacturers((prev) => [...prev, { id: created.id, name: created.name }]);
      setNewAliasManufacturerId(created.id);
      setShowNewManufacturer(false);
      setNewManufacturerName('');
      toast({ title: 'Manufacturer created', description: `"${created.name}" has been added.` });
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to create manufacturer',
        variant: 'destructive',
      });
    } finally {
      setNewManufacturerLoading(false);
    }
  };

  const handleAddAlias = async () => {
    if (!addAliasTarget || !newAliasLabel.trim()) return;
    try {
      setAddAliasLoading(true);
      const saved = await upsertManufacturerFieldLabel({
        fieldDefinitionId: addAliasTarget.fieldDefId,
        manufacturerId: newAliasManufacturerId || null,
        manufacturerFieldLabel: newAliasLabel.trim(),
      });
      setAliasesMap((prev) => {
        const existing = prev.get(addAliasTarget.fieldDefId) ?? [];
        const alreadyExists = existing.some((a) => a.id === saved.id);
        return new Map(prev).set(
          addAliasTarget.fieldDefId,
          alreadyExists
            ? existing.map((a) => (a.id === saved.id ? saved : a))
            : [...existing, saved]
        );
      });
      toast({ title: 'Alias added', description: `"${saved.manufacturerFieldLabel}" mapped to this field.` });
      setAddAliasTarget(null);
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to add alias',
        variant: 'destructive',
      });
    } finally {
      setAddAliasLoading(false);
    }
  };

  const categoryCounts = {
    doors: itemTypes.filter((i) => i.category === 'doors').length,
    frames: itemTypes.filter((i) => i.category === 'frames').length,
    hardware: itemTypes.filter((i) => i.category === 'hardware').length,
  };

  const filteredItemTypes = itemTypes.filter((item) => {
    if (item.category !== activeCategory) return false;
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      item.itemLabel.toLowerCase().includes(q) ||
      item.canonicalCode.toLowerCase().includes(q) ||
      (item.series ?? '').toLowerCase().includes(q) ||
      (item.material ?? '').toLowerCase().includes(q)
    );
  });

  const totalFieldsManaged = Array.from(itemTypeFieldsMap.values()).reduce(
    (acc, fields) => acc + fields.length,
    0
  );
  const totalRequiredFields = Array.from(itemTypeFieldsMap.values()).reduce(
    (acc, fields) => acc + fields.filter((f) => f.isRequired).length,
    0
  );

  const handleToggleRequired = async (canonicalCode: string, field: ItemTypeField) => {
    try {
      setActionLoading(field.id);
      const updated = await upsertItemTypeField(
        canonicalCode,
        field.fieldDefinitionId,
        !field.isRequired
      );
      setItemTypeFieldsMap((prev) => {
        const fields = prev.get(canonicalCode) ?? [];
        return new Map(prev).set(
          canonicalCode,
          fields.map((f) => (f.id === updated.id ? updated : f))
        );
      });
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to update required flag',
        variant: 'destructive',
      });
    } finally {
      setActionLoading(null);
    }
  };

  const handleStatusChange = async (
    canonicalCode: string,
    field: ItemTypeField,
    newStatus: FieldDefinitionStatus
  ) => {
    if (!field.fieldDefinition) return;
    try {
      setActionLoading(field.id);
      const updated = await updateFieldDefinitionStatus(field.fieldDefinition.id, newStatus);
      setItemTypeFieldsMap((prev) => {
        const fields = prev.get(canonicalCode) ?? [];
        return new Map(prev).set(
          canonicalCode,
          fields.map((f) =>
            f.id === field.id ? { ...f, fieldDefinition: updated } : f
          )
        );
      });
      toast({
        title: newStatus === 'approved' ? 'Field approved' : 'Field moved to pending',
        description: `"${updated.fieldLabel}" status updated.`,
      });
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to update status',
        variant: 'destructive',
      });
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const { field } = deleteTarget;
    const isPendingReview = field.fieldDefinition?.status === 'pending_review';
    try {
      setActionLoading(field.id);
      await deleteItemTypeField(field.id);
      setItemTypeFieldsMap((prev) => {
        const fields = prev.get(deleteTarget.canonicalCode) ?? [];
        return new Map(prev).set(
          deleteTarget.canonicalCode,
          fields.filter((f) => f.id !== field.id)
        );
      });

      if (isPendingReview && field.fieldDefinition) {
        const blocked = await addBlockedFieldLabel({
          fieldLabel: field.fieldDefinition.fieldLabel,
          fieldKey: field.fieldDefinition.fieldKey,
          fieldDefinitionId: field.fieldDefinition.id,
        });
        setBlockedLabels((prev) =>
          prev.some((b) => b.id === blocked.id) ? prev : [blocked, ...prev]
        );
        toast({
          title: 'Field removed & blocked',
          description: `"${field.fieldDefinition.fieldLabel}" has been added to the blocked list. The AI will not extract this field in future estimates.`,
        });
      } else {
        toast({ title: 'Field removed', description: 'Field association removed from this item type.' });
      }
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to remove field',
        variant: 'destructive',
      });
    } finally {
      setActionLoading(null);
      setDeleteTarget(null);
    }
  };

  const handleDeleteItem = async () => {
    if (!deleteItemTarget) return;
    try {
      setDeleteItemLoading(true);
      await deleteItemType(deleteItemTarget.canonicalCodes);
      setItemTypes((prev) =>
        prev.filter((t) => !deleteItemTarget.canonicalCodes.includes(t.canonicalCode))
      );
      setItemTypeFieldsMap((prev) => {
        const next = new Map(prev);
        for (const code of deleteItemTarget.canonicalCodes) {
          next.delete(code);
        }
        return next;
      });
      setExpandedCodes((prev) => {
        const next = new Set(prev);
        for (const code of deleteItemTarget.canonicalCodes) {
          next.delete(code);
        }
        return next;
      });
      toast({ title: 'Item deleted', description: `"${deleteItemTarget.itemLabel}" has been removed.` });
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to delete item',
        variant: 'destructive',
      });
    } finally {
      setDeleteItemLoading(false);
      setDeleteItemTarget(null);
    }
  };

  const openRenameDialog = (item: ItemType) => {
    setRenameTarget(item);
    setRenameLabel(item.itemLabel);
  };

  const handleRenameSave = async () => {
    if (!renameTarget || !renameLabel.trim()) return;
    try {
      setRenameLoading(true);
      await renameItemType(renameTarget.canonicalCodes, renameLabel.trim());
      setItemTypes((prev) =>
        prev.map((t) =>
          t.canonicalCode === renameTarget.canonicalCode
            ? { ...t, itemLabel: renameLabel.trim() }
            : t
        )
      );
      toast({ title: 'Item renamed', description: `Item has been renamed to "${renameLabel.trim()}".` });
      setRenameTarget(null);
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to rename item',
        variant: 'destructive',
      });
    } finally {
      setRenameLoading(false);
    }
  };

  const openEditDialog = (field: ItemTypeField) => {
    setEditTarget(field);
    setEditLabel(field.fieldDefinition?.fieldLabel ?? '');
  };

  const handleEditSave = async () => {
    if (!editTarget || !editTarget.fieldDefinition) return;
    try {
      setActionLoading(editTarget.id);
      const updated = await updateFieldDefinition(editTarget.fieldDefinition.id, {
        fieldLabel: editLabel,
      });
      setItemTypeFieldsMap((prev) => {
        const next = new Map(prev);
        for (const [code, fields] of next.entries()) {
          next.set(
            code,
            fields.map((f) =>
              f.fieldDefinitionId === updated.id ? { ...f, fieldDefinition: updated } : f
            )
          );
        }
        return next;
      });
      toast({ title: 'Field updated', description: `"${updated.fieldLabel}" has been updated.` });
      setEditTarget(null);
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to update field',
        variant: 'destructive',
      });
    } finally {
      setActionLoading(null);
    }
  };

  const handleUnblock = async (blocked: BlockedFieldLabel) => {
    try {
      setUnblockLoading(blocked.id);
      await removeBlockedFieldLabel(blocked.id);
      setBlockedLabels((prev) => prev.filter((b) => b.id !== blocked.id));
      toast({ title: 'Field unblocked', description: `"${blocked.fieldLabel}" can now be extracted by the AI again.` });
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to unblock field',
        variant: 'destructive',
      });
    } finally {
      setUnblockLoading(null);
    }
  };

  const openAddField = (canonicalCode: string) => {
    setAddFieldTarget(canonicalCode);
    setSelectedFieldDefId('');
    setAddFieldMode('select');
    setNewFieldLabel('');
    setNewFieldKey('');
    setNewFieldValueType('string');
  };

  const handleAddField = async () => {
    if (!addFieldTarget) return;
    try {
      setActionLoading('add-field');
      let fieldDefId = selectedFieldDefId;

      if (addFieldMode === 'create') {
        if (!newFieldLabel.trim() || !newFieldKey.trim()) return;
        const created = await createOrApproveFieldDefinition({
          fieldKey: newFieldKey.trim(),
          fieldLabel: newFieldLabel.trim(),
          valueType: newFieldValueType,
        });
        setAllFieldDefs((prev) => {
          if (prev.some((fd) => fd.id === created.id)) return prev;
          return [created, ...prev];
        });
        fieldDefId = created.id;
      }

      if (!fieldDefId) return;
      const newField = await upsertItemTypeField(addFieldTarget, fieldDefId, false);
      setItemTypeFieldsMap((prev) => {
        const existing = prev.get(addFieldTarget) ?? [];
        if (existing.some((f) => f.id === newField.id)) return prev;
        return new Map(prev).set(addFieldTarget, [...existing, newField]);
      });
      toast({ title: 'Field added', description: 'Field has been associated with this item type.' });
      setAddFieldTarget(null);
      setSelectedFieldDefId('');
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to add field',
        variant: 'destructive',
      });
    } finally {
      setActionLoading(null);
    }
  };

  const getStatusBadge = (status: FieldDefinitionStatus) => {
    if (status === 'approved') {
      return (
        <Badge variant="outline" className="flex w-fit items-center gap-1">
          <CheckCircle2 className="h-3 w-3 text-emerald-500" />
          Approved
        </Badge>
      );
    }
    return (
      <Badge
        variant="secondary"
        className="flex w-fit items-center gap-1 bg-amber-500/10 text-amber-600 dark:text-amber-400"
      >
        <Clock className="h-3 w-3" />
        Pending
      </Badge>
    );
  };

  return (
    <div className="p-6 lg:p-8">
      {/* Page Header */}
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-4xl tracking-wide">Items</h1>
          <p className="mt-1 text-muted-foreground">
            Manage item types and their associated field definitions
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search items..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <Button variant="outline" size="sm" onClick={fetchItemTypes} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Category Tabs */}
      <div className="mb-6 flex gap-1 rounded-lg border bg-muted/30 p-1 w-fit">
        {CATEGORIES.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setActiveCategory(key)}
            className={[
              'flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-all',
              activeCategory === key
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            ].join(' ')}
          >
            <Icon className="h-4 w-4" />
            {label}
            <span
              className={[
                'rounded-full px-1.5 py-0.5 text-xs font-semibold tabular-nums',
                activeCategory === key
                  ? 'bg-primary/10 text-primary'
                  : 'bg-muted text-muted-foreground',
              ].join(' ')}
            >
              {categoryCounts[key]}
            </span>
          </button>
        ))}
      </div>

      {/* Summary Cards */}
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <p className="text-sm text-muted-foreground">
              {CATEGORIES.find((c) => c.key === activeCategory)?.label} Items
            </p>
            <p className="text-3xl font-bold">{categoryCounts[activeCategory]}</p>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">Unique item groups</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <p className="text-sm text-muted-foreground">Total Fields Managed</p>
            <p className="text-3xl font-bold">{totalFieldsManaged}</p>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">Across expanded item types</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <p className="text-sm text-muted-foreground">Required Fields</p>
            <p className="text-3xl font-bold text-amber-600 dark:text-amber-400">
              {totalRequiredFields}
            </p>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">Auto-inserted in estimate wizard</p>
          </CardContent>
        </Card>
      </div>

      {/* Error State */}
      {error && (
        <div className="mb-6 flex items-center gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Hardware catalog sub-tabs — only shown when hardware category is active */}
      {!loading && activeCategory === 'hardware' && (
        <div className="mb-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-1 rounded-lg border bg-muted/30 p-1">
              {HARDWARE_SUBCATEGORIES.map(({ key, label }) => {
                const count = catalogItems.filter((i) => i.subcategory === key).length;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setHardwareSubtab(key)}
                    className={[
                      'flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-all',
                      hardwareSubtab === key
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground',
                    ].join(' ')}
                  >
                    {label}
                    <span
                      className={[
                        'rounded-full px-1.5 py-0.5 text-xs font-semibold tabular-nums',
                        hardwareSubtab === key
                          ? 'bg-primary/10 text-primary'
                          : 'bg-muted text-muted-foreground',
                      ].join(' ')}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => setHardwareSubtab('discovered')}
                className={[
                  'flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-all',
                  hardwareSubtab === 'discovered'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                ].join(' ')}
              >
                <Search className="h-3.5 w-3.5" />
                Discovered
                <span
                  className={[
                    'rounded-full px-1.5 py-0.5 text-xs font-semibold tabular-nums',
                    hardwareSubtab === 'discovered'
                      ? 'bg-primary/10 text-primary'
                      : 'bg-muted text-muted-foreground',
                  ].join(' ')}
                >
                  {categoryCounts.hardware}
                </span>
              </button>
            </div>
            {isAdmin && hardwareSubtab !== 'discovered' && (
              <Button
                size="sm"
                onClick={() => openAddCatalogDialog(hardwareSubtab as HardwareSubcategory)}
              >
                <Plus className="mr-2 h-4 w-4" />
                Add Item
              </Button>
            )}
          </div>

          {/* Catalog sub-tab content (hidden for 'discovered' — item list below handles that) */}
          {hardwareSubtab !== 'discovered' && (
            <div className="mt-4">
              {catalogLoading ? (
                <div className="flex items-center justify-center py-12">
                  <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground/50" />
                </div>
              ) : (() => {
                const items = catalogItems.filter((i) => i.subcategory === hardwareSubtab);
                return items.length === 0 ? (
                  <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
                    <Wrench className="mb-4 h-10 w-10 text-muted-foreground/30" />
                    <p className="text-sm font-medium text-muted-foreground">
                      No items in {SUBCATEGORY_LABEL[hardwareSubtab as HardwareSubcategory]}
                    </p>
                    {isAdmin && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-4"
                        onClick={() => openAddCatalogDialog(hardwareSubtab as HardwareSubcategory)}
                      >
                        <Plus className="mr-2 h-4 w-4" />
                        Add First Item
                      </Button>
                    )}
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-lg border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Name</TableHead>
                          <TableHead>Description</TableHead>
                          <TableHead>Active</TableHead>
                          {isAdmin && <TableHead className="w-24 text-right">Actions</TableHead>}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {items.map((item) => (
                          <TableRow key={item.id}>
                            <TableCell className="font-medium">{item.name}</TableCell>
                            <TableCell className="text-sm text-muted-foreground max-w-xs truncate">
                              {item.description ?? <span className="text-muted-foreground/50">—</span>}
                            </TableCell>
                            <TableCell>
                              {item.active ? (
                                <Badge variant="outline" className="flex w-fit items-center gap-1 text-emerald-700 border-emerald-200 bg-emerald-50 dark:text-emerald-400 dark:border-emerald-800/40 dark:bg-emerald-900/20">
                                  <CheckCircle2 className="h-3 w-3" />
                                  Active
                                </Badge>
                              ) : (
                                <Badge variant="secondary" className="flex w-fit items-center gap-1 text-muted-foreground">
                                  <ToggleLeft className="h-3 w-3" />
                                  Inactive
                                </Badge>
                              )}
                            </TableCell>
                            {isAdmin && (
                              <TableCell>
                                <div className="flex items-center justify-end gap-1">
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8"
                                        onClick={() => openEditCatalogDialog(item)}
                                      >
                                        <Pencil className="h-4 w-4" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Edit item</TooltipContent>
                                  </Tooltip>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                                        onClick={() => setCatalogDeleteTarget(item)}
                                      >
                                        <Trash2 className="h-4 w-4" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Delete item</TooltipContent>
                                  </Tooltip>
                                </div>
                              </TableCell>
                            )}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      )}

      {/* Item List — shown for non-hardware categories OR hardware 'discovered' sub-tab */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-16">
          <RefreshCw className="mb-4 h-8 w-8 animate-spin text-muted-foreground/50" />
          <p className="text-muted-foreground">Loading item types...</p>
        </div>
      ) : activeCategory === 'hardware' && hardwareSubtab !== 'discovered' ? null
      : filteredItemTypes.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16">
          <Boxes className="mb-4 h-12 w-12 text-muted-foreground/50" />
          <p className="text-muted-foreground">
            {searchQuery
              ? 'No item types match your search'
              : activeCategory === 'hardware'
              ? 'No discovered hardware items yet — hardware items appear here as they are added to estimates'
              : 'No item types found'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredItemTypes.map((item) => {
            const isExpanded = expandedCodes.has(item.canonicalCode);
            const isFieldsLoading = fieldsLoading.has(item.canonicalCode);
            const fields = itemTypeFieldsMap.get(item.canonicalCode) ?? [];
            const requiredCount = fields.filter((f) => f.isRequired).length;
            const hasLoadedFields = itemTypeFieldsMap.has(item.canonicalCode);
            const hasKeyFields = item.series || item.material || item.openingWidth || item.openingHeight;
            const hasVariants = item.canonicalCodes.length > 1;

            return (
              <Card key={item.canonicalCode} className="overflow-hidden">
                {/* Item Header Row */}
                <button
                  type="button"
                  className="flex w-full items-center gap-4 p-4 text-left transition-colors hover:bg-muted/30"
                  onClick={() => toggleExpand(item)}
                >
                  <span className="shrink-0 text-muted-foreground">
                    {isExpanded ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">
                        {item.series ?? item.itemLabel}
                      </span>
                      {hasVariants && (
                        <Badge variant="outline" className="font-mono text-xs">
                          {item.canonicalCodes.length} variants
                        </Badge>
                      )}
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      <span className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-muted/40 px-1.5 py-0.5 text-[11px] leading-none">
                        <span className="text-muted-foreground/70">Code</span>
                        <span className="font-mono font-medium text-foreground/80">
                          {hasVariants ? item.canonicalCodes[0] : item.canonicalCode}
                        </span>
                      </span>
                      {item.series && item.series !== item.itemLabel && (
                        <span className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-muted/40 px-1.5 py-0.5 text-[11px] leading-none">
                          <span className="text-muted-foreground/70">Series</span>
                          <span className="font-medium text-foreground/80">{item.series}</span>
                        </span>
                      )}
                      {item.material && (
                        <span className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-muted/40 px-1.5 py-0.5 text-[11px] leading-none">
                          <span className="text-muted-foreground/70">Material</span>
                          <span className="font-medium text-foreground/80">{item.material}</span>
                        </span>
                      )}
                      {item.openingWidth && (
                        <span className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-muted/40 px-1.5 py-0.5 text-[11px] leading-none">
                          <span className="text-muted-foreground/70">W</span>
                          <span className="font-medium text-foreground/80">{item.openingWidth}</span>
                        </span>
                      )}
                      {item.openingHeight && (
                        <span className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-muted/40 px-1.5 py-0.5 text-[11px] leading-none">
                          <span className="text-muted-foreground/70">H</span>
                          <span className="font-medium text-foreground/80">{item.openingHeight}</span>
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant="secondary" className="text-xs">
                      {item.usageCount} {item.usageCount === 1 ? 'use' : 'uses'}
                    </Badge>
                    {hasLoadedFields && (
                      <>
                        <Badge variant="secondary" className="text-xs">
                          {fields.length} {fields.length === 1 ? 'field' : 'fields'}
                        </Badge>
                        {requiredCount > 0 && (
                          <Badge
                            variant="secondary"
                            className="text-xs bg-amber-500/10 text-amber-600 dark:text-amber-400"
                          >
                            {requiredCount} required
                          </Badge>
                        )}
                      </>
                    )}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={(e) => {
                            e.stopPropagation();
                            openRenameDialog(item);
                          }}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Rename item</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteItemTarget(item);
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Delete item type</TooltipContent>
                    </Tooltip>
                  </div>
                </button>

                {/* Expanded Field Management Panel */}
                {isExpanded && (
                  <div className="border-t">
                    {hasVariants && (
                      <div className="border-b bg-muted/20 px-4 py-2 text-xs text-muted-foreground">
                        Fields managed via primary code:{' '}
                        <code className="rounded bg-muted px-1">{item.canonicalCode}</code>
                        {' '}({item.canonicalCodes.length} variants share these key dimensions)
                      </div>
                    )}

                    {isFieldsLoading ? (
                      <div className="flex items-center justify-center py-8">
                        <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground/50" />
                      </div>
                    ) : fields.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-8 text-center">
                        <p className="mb-4 text-sm text-muted-foreground">
                          No fields associated with this item type yet.
                        </p>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openAddField(item.canonicalCode)}
                        >
                          <Plus className="mr-2 h-4 w-4" />
                          Add Field
                        </Button>
                      </div>
                    ) : (
                      <>
                        <div className="overflow-x-auto">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead className="w-8" />
                                <TableHead>Field Label</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead>Required</TableHead>
                                <TableHead className="w-28 text-right">Actions</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {fields.map((field) => {
                                const fieldDefId = field.fieldDefinitionId;
                                const isAliasExpanded = expandedFieldAliases.has(field.id);
                                const isAliasLoading = aliasesLoading.has(fieldDefId);
                                const aliases = aliasesMap.get(fieldDefId) ?? [];

                                return (
                                  <>
                                    <TableRow key={field.id}>
                                      {/* Alias expand toggle */}
                                      <TableCell className="p-0 pl-3">
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <button
                                              type="button"
                                              className="flex h-8 w-8 items-center justify-center rounded hover:bg-muted/60 text-muted-foreground transition-colors"
                                              onClick={() =>
                                                toggleFieldAliases(field.id, fieldDefId)
                                              }
                                            >
                                              {isAliasExpanded ? (
                                                <ChevronDown className="h-3.5 w-3.5" />
                                              ) : (
                                                <ChevronRight className="h-3.5 w-3.5" />
                                              )}
                                            </button>
                                          </TooltipTrigger>
                                          <TooltipContent>
                                            {isAliasExpanded ? 'Hide' : 'View'} manufacturer aliases
                                          </TooltipContent>
                                        </Tooltip>
                                      </TableCell>

                                      <TableCell className="font-medium">
                                        {field.fieldDefinition?.fieldLabel ?? '—'}
                                      </TableCell>

                                      <TableCell>
                                        {field.fieldDefinition
                                          ? getStatusBadge(field.fieldDefinition.status)
                                          : '—'}
                                      </TableCell>

                                      <TableCell>
                                        <Switch
                                          checked={field.isRequired}
                                          onCheckedChange={() =>
                                            handleToggleRequired(item.canonicalCode, field)
                                          }
                                          disabled={actionLoading === field.id}
                                        />
                                      </TableCell>

                                      <TableCell>
                                        <div className="flex items-center justify-end gap-1">
                                          {field.fieldDefinition?.status === 'pending_review' ? (
                                            <Tooltip>
                                              <TooltipTrigger asChild>
                                                <Button
                                                  variant="ghost"
                                                  size="icon"
                                                  className="h-8 w-8 text-emerald-600 hover:bg-emerald-500/10 hover:text-emerald-600"
                                                  onClick={() =>
                                                    handleStatusChange(
                                                      item.canonicalCode,
                                                      field,
                                                      'approved'
                                                    )
                                                  }
                                                  disabled={actionLoading === field.id}
                                                >
                                                  <Check className="h-4 w-4" />
                                                </Button>
                                              </TooltipTrigger>
                                              <TooltipContent>Approve</TooltipContent>
                                            </Tooltip>
                                          ) : (
                                            <Tooltip>
                                              <TooltipTrigger asChild>
                                                <Button
                                                  variant="ghost"
                                                  size="icon"
                                                  className="h-8 w-8 text-amber-600 hover:bg-amber-500/10 hover:text-amber-600"
                                                  onClick={() =>
                                                    handleStatusChange(
                                                      item.canonicalCode,
                                                      field,
                                                      'pending_review'
                                                    )
                                                  }
                                                  disabled={actionLoading === field.id}
                                                >
                                                  <X className="h-4 w-4" />
                                                </Button>
                                              </TooltipTrigger>
                                              <TooltipContent>Move to Pending</TooltipContent>
                                            </Tooltip>
                                          )}
                                          <Tooltip>
                                            <TooltipTrigger asChild>
                                              <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-8 w-8"
                                                onClick={() => openEditDialog(field)}
                                                disabled={actionLoading === field.id}
                                              >
                                                <Pencil className="h-4 w-4" />
                                              </Button>
                                            </TooltipTrigger>
                                            <TooltipContent>Edit label</TooltipContent>
                                          </Tooltip>
                                          <Tooltip>
                                            <TooltipTrigger asChild>
                                              <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                                                onClick={() =>
                                                  setDeleteTarget({
                                                    field,
                                                    canonicalCode: item.canonicalCode,
                                                  })
                                                }
                                                disabled={actionLoading === field.id}
                                              >
                                                <Trash2 className="h-4 w-4" />
                                              </Button>
                                            </TooltipTrigger>
                                            <TooltipContent>Remove from item type</TooltipContent>
                                          </Tooltip>
                                        </div>
                                      </TableCell>
                                    </TableRow>

                                    {/* Manufacturer Aliases Sub-Row */}
                                    {isAliasExpanded && (
                                      <TableRow key={`${field.id}-aliases`} className="bg-muted/20 hover:bg-muted/20">
                                        <TableCell />
                                        <TableCell colSpan={4} className="py-3 pl-4 pr-4">
                                          <div className="space-y-2">
                                            <div className="flex items-center justify-between">
                                              <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                                                <Building2 className="h-3 w-3" />
                                                Manufacturer Aliases
                                              </p>
                                              <Button
                                                variant="ghost"
                                                size="sm"
                                                className="h-7 text-xs"
                                                onClick={() =>
                                                  openAddAlias(
                                                    fieldDefId,
                                                    field.fieldDefinition?.fieldLabel ?? ''
                                                  )
                                                }
                                              >
                                                <Plus className="mr-1 h-3 w-3" />
                                                Add Alias
                                              </Button>
                                            </div>

                                            {isAliasLoading ? (
                                              <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
                                                <RefreshCw className="h-3 w-3 animate-spin" />
                                                Loading aliases…
                                              </div>
                                            ) : aliases.length === 0 ? (
                                              <p className="text-xs text-muted-foreground py-1">
                                                No manufacturer aliases yet. Add one to map how manufacturers refer to this field.
                                              </p>
                                            ) : (
                                              <div className="flex flex-wrap gap-2">
                                                {aliases.map((alias) => {
                                                  const isPending = alias.status === 'pending';
                                                  const isActioning = actionLoading === `alias-${alias.id}`;
                                                  return (
                                                    <div
                                                      key={alias.id}
                                                      className={[
                                                        'flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors',
                                                        isPending
                                                          ? 'border-amber-200 bg-amber-50 dark:border-amber-800/40 dark:bg-amber-900/20'
                                                          : 'border-emerald-200 bg-emerald-50 dark:border-emerald-800/40 dark:bg-emerald-900/20',
                                                      ].join(' ')}
                                                    >
                                                      {isPending ? (
                                                        <Clock className="h-3 w-3 shrink-0 text-amber-500" />
                                                      ) : (
                                                        <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-500" />
                                                      )}
                                                      <Building2 className="h-3 w-3 shrink-0 text-muted-foreground" />
                                                      <span className={['font-medium', isPending ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300'].join(' ')}>
                                                        {alias.manufacturer?.name ?? 'Any Manufacturer'}
                                                      </span>
                                                      <span className="text-muted-foreground">→</span>
                                                      <span className="flex items-center gap-1">
                                                        <Tag className="h-3 w-3 text-muted-foreground" />
                                                        <span className={isPending ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300'}>
                                                          {alias.manufacturerFieldLabel}
                                                        </span>
                                                      </span>
                                                      <div className="ml-1 flex items-center gap-0.5">
                                                        {isPending && (
                                                          <Tooltip>
                                                            <TooltipTrigger asChild>
                                                              <button
                                                                type="button"
                                                                className="rounded p-0.5 text-muted-foreground hover:bg-emerald-500/20 hover:text-emerald-600 transition-colors"
                                                                onClick={() => handleApproveAlias(alias, fieldDefId)}
                                                                disabled={isActioning}
                                                              >
                                                                <Check className="h-3 w-3" />
                                                              </button>
                                                            </TooltipTrigger>
                                                            <TooltipContent>Approve alias</TooltipContent>
                                                          </Tooltip>
                                                        )}
                                                        <Tooltip>
                                                          <TooltipTrigger asChild>
                                                            <button
                                                              type="button"
                                                              className="rounded p-0.5 text-muted-foreground hover:bg-blue-500/20 hover:text-blue-600 transition-colors"
                                                              onClick={() => openMoveAlias(alias, fieldDefId)}
                                                              disabled={isActioning}
                                                            >
                                                              <ArrowLeftRight className="h-3 w-3" />
                                                            </button>
                                                          </TooltipTrigger>
                                                          <TooltipContent>Move to different field</TooltipContent>
                                                        </Tooltip>
                                                        <Tooltip>
                                                          <TooltipTrigger asChild>
                                                            <button
                                                              type="button"
                                                              className="rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                                                              onClick={() => handleDeleteAlias(alias, fieldDefId)}
                                                              disabled={isActioning}
                                                            >
                                                              <X className="h-3 w-3" />
                                                            </button>
                                                          </TooltipTrigger>
                                                          <TooltipContent>Remove & block alias</TooltipContent>
                                                        </Tooltip>
                                                      </div>
                                                    </div>
                                                  );
                                                })}
                                              </div>
                                            )}
                                          </div>
                                        </TableCell>
                                      </TableRow>
                                    )}
                                  </>
                                );
                              })}
                            </TableBody>
                          </Table>
                        </div>
                        <div className="flex justify-end border-t px-4 py-3">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openAddField(item.canonicalCode)}
                          >
                            <Plus className="mr-2 h-4 w-4" />
                            Add Field
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* Blocked Field Labels Section */}
      <div className="mt-10">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Ban className="h-5 w-5 text-destructive" />
            <div>
              <h2 className="text-lg font-semibold">Blocked Fields</h2>
              <p className="text-sm text-muted-foreground">
                These field labels will never be extracted by the AI in future estimates.
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={fetchBlockedLabels} disabled={blockedLabelsLoading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${blockedLabelsLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        {blockedLabelsLoading ? (
          <div className="flex items-center justify-center py-8">
            <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground/50" />
          </div>
        ) : blockedLabels.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-10 text-center">
            <ShieldOff className="mb-3 h-10 w-10 text-muted-foreground/30" />
            <p className="text-sm font-medium text-muted-foreground">No blocked fields yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              When you delete a pending field from an item type, it will appear here.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Field Label</TableHead>
                  <TableHead>Field Key</TableHead>
                  <TableHead>Blocked On</TableHead>
                  <TableHead className="w-24 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {blockedLabels.map((blocked) => (
                  <TableRow key={blocked.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <Ban className="h-3.5 w-3.5 shrink-0 text-destructive" />
                        {blocked.fieldLabel}
                      </div>
                    </TableCell>
                    <TableCell>
                      {blocked.fieldKey ? (
                        <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                          {blocked.fieldKey}
                        </code>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(blocked.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs text-muted-foreground hover:text-foreground"
                              onClick={() => handleUnblock(blocked)}
                              disabled={unblockLoading === blocked.id}
                            >
                              {unblockLoading === blocked.id ? (
                                <RefreshCw className="mr-1.5 h-3 w-3 animate-spin" />
                              ) : (
                                <X className="mr-1.5 h-3 w-3" />
                              )}
                              Unblock
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Allow AI to extract this field again</TooltipContent>
                        </Tooltip>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* Delete Field Association Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove field association?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  This will remove{' '}
                  <span className="font-semibold">
                    &ldquo;{deleteTarget?.field.fieldDefinition?.fieldLabel}&rdquo;
                  </span>{' '}
                  from this item type.
                </p>
                {deleteTarget?.field.fieldDefinition?.status === 'pending_review' && (
                  <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800/40 dark:bg-amber-900/20 dark:text-amber-300">
                    <Ban className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      Since this field is not yet approved, it will also be added to the{' '}
                      <strong>Blocked List</strong>. The AI will never try to extract or add this
                      field in future estimates.
                    </span>
                  </div>
                )}
                <p className="text-xs text-muted-foreground">This action cannot be undone.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteTarget?.field.fieldDefinition?.status === 'pending_review' ? 'Remove & Block' : 'Remove'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit Label Dialog */}
      <Dialog open={!!editTarget} onOpenChange={(open) => !open && setEditTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display text-2xl">Edit Field Label</DialogTitle>
            <DialogDescription>
              Update the display label for{' '}
              <code className="rounded bg-muted px-1 text-xs">
                {editTarget?.fieldDefinition?.fieldKey}
              </code>
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-label">Display Label</Label>
              <Input
                id="edit-label"
                value={editLabel}
                onChange={(e) => setEditLabel(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter className="mt-6">
            <Button variant="outline" onClick={() => setEditTarget(null)}>
              Cancel
            </Button>
            <Button
              onClick={handleEditSave}
              disabled={!editLabel.trim() || actionLoading === editTarget?.id}
            >
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename Item Dialog */}
      <Dialog open={!!renameTarget} onOpenChange={(open) => !open && setRenameTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display text-2xl">Rename Item</DialogTitle>
            <DialogDescription>
              Update the display name for{' '}
              <code className="rounded bg-muted px-1 text-xs">
                {renameTarget?.canonicalCode}
              </code>
              {renameTarget && renameTarget.canonicalCodes.length > 1 && (
                <> and {renameTarget.canonicalCodes.length - 1} other variant{renameTarget.canonicalCodes.length > 2 ? 's' : ''}</>
              )}
              . This will update the name across all estimate line items.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="rename-label">Item Name</Label>
              <Input
                id="rename-label"
                value={renameLabel}
                onChange={(e) => setRenameLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && renameLabel.trim()) handleRenameSave();
                }}
                autoFocus
              />
            </div>
          </div>
          <DialogFooter className="mt-6">
            <Button variant="outline" onClick={() => setRenameTarget(null)}>
              Cancel
            </Button>
            <Button
              onClick={handleRenameSave}
              disabled={!renameLabel.trim() || renameLoading}
            >
              {renameLoading ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Item Type Confirmation Dialog */}
      <AlertDialog open={!!deleteItemTarget} onOpenChange={() => setDeleteItemTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete item type?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete{' '}
              <span className="font-semibold">
                &ldquo;{deleteItemTarget?.itemLabel}&rdquo;
              </span>{' '}
              and all its occurrences across every estimate
              {deleteItemTarget && deleteItemTarget.canonicalCodes.length > 1 && (
                <> ({deleteItemTarget.canonicalCodes.length} variants)</>
              )}
              . Associated field definitions will not be deleted, but all
              field associations and line items for this product will be removed.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteItemLoading}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteItem}
              disabled={deleteItemLoading}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteItemLoading ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Add Field Dialog */}
      <Dialog open={!!addFieldTarget} onOpenChange={(open) => !open && setAddFieldTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display text-2xl">Add Field</DialogTitle>
            <DialogDescription>
              Associate a field with this item type. Required fields are auto-inserted when
              the item is added to an estimate.
            </DialogDescription>
          </DialogHeader>

          <Tabs
            value={addFieldMode}
            onValueChange={(v) => setAddFieldMode(v as 'select' | 'create')}
            className="mt-4"
          >
            <TabsList className="w-full">
              <TabsTrigger value="select" className="flex-1">Select existing</TabsTrigger>
              <TabsTrigger value="create" className="flex-1">Create new</TabsTrigger>
            </TabsList>

            {/* ── Select existing ── */}
            <TabsContent value="select" className="mt-4 space-y-2">
              <Label htmlFor="field-select">Field Definition</Label>
              {(() => {
                const alreadyLinked = addFieldTarget
                  ? (itemTypeFieldsMap.get(addFieldTarget) ?? []).map((f) => f.fieldDefinitionId)
                  : [];
                const available = allFieldDefs.filter((fd) => !alreadyLinked.includes(fd.id));
                return available.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    All available field definitions are already linked to this item type.
                  </p>
                ) : (
                  <Select value={selectedFieldDefId} onValueChange={setSelectedFieldDefId}>
                    <SelectTrigger id="field-select">
                      <SelectValue placeholder="Select a field..." />
                    </SelectTrigger>
                    <SelectContent>
                      {available.map((fd) => (
                        <SelectItem key={fd.id} value={fd.id}>
                          <span>{fd.fieldLabel}</span>
                          <span className="ml-1 font-mono text-xs text-muted-foreground">
                            ({fd.fieldKey})
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                );
              })()}
            </TabsContent>

            {/* ── Create new ── */}
            <TabsContent value="create" className="mt-4 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="new-field-label">Field Label</Label>
                <Input
                  id="new-field-label"
                  placeholder="e.g. Glass Type"
                  value={newFieldLabel}
                  onChange={(e) => {
                    const label = e.target.value;
                    setNewFieldLabel(label);
                    setNewFieldKey(
                      label
                        .toLowerCase()
                        .trim()
                        .replace(/[^a-z0-9]+/g, '_')
                        .replace(/^_+|_+$/g, '')
                    );
                  }}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-field-key">Field Key</Label>
                <Input
                  id="new-field-key"
                  placeholder="e.g. glass_type"
                  value={newFieldKey}
                  onChange={(e) => setNewFieldKey(e.target.value)}
                  className="font-mono text-sm"
                />
                <p className="text-[11px] text-muted-foreground">
                  Unique machine-readable identifier. Auto-filled from the label.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-field-value-type">Value Type</Label>
                <Select
                  value={newFieldValueType}
                  onValueChange={(v) => setNewFieldValueType(v as FieldValueType)}
                >
                  <SelectTrigger id="new-field-value-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="string">Text</SelectItem>
                    <SelectItem value="number">Number</SelectItem>
                    <SelectItem value="bool">Yes / No</SelectItem>
                    <SelectItem value="date">Date</SelectItem>
                    <SelectItem value="code">Code</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </TabsContent>
          </Tabs>

          <DialogFooter className="mt-6">
            <Button variant="outline" onClick={() => setAddFieldTarget(null)}>
              Cancel
            </Button>
            <Button
              onClick={handleAddField}
              disabled={
                actionLoading === 'add-field' ||
                (addFieldMode === 'select' && !selectedFieldDefId) ||
                (addFieldMode === 'create' && (!newFieldLabel.trim() || !newFieldKey.trim()))
              }
            >
              {addFieldMode === 'create' ? 'Create & Add Field' : 'Add Field'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Manufacturer Alias Dialog */}
      <Dialog open={!!addAliasTarget} onOpenChange={(open) => !open && setAddAliasTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display text-2xl">Add Manufacturer Alias</DialogTitle>
            <DialogDescription>
              Map how a manufacturer refers to the master field{' '}
              <span className="font-semibold">&ldquo;{addAliasTarget?.fieldLabel}&rdquo;</span>.
              This helps the AI normalize manufacturer terminology during extraction.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="alias-manufacturer">Manufacturer</Label>
              <Select
                value={newAliasManufacturerId || '__none__'}
                onValueChange={(v) => {
                  setNewAliasManufacturerId(v === '__none__' ? '' : v);
                  setShowNewManufacturer(false);
                }}
              >
                <SelectTrigger id="alias-manufacturer">
                  <SelectValue placeholder="Any manufacturer (generic alias)..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Any manufacturer (generic alias)</SelectItem>
                  {manufacturers.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!showNewManufacturer ? (
                <button
                  type="button"
                  className="flex items-center gap-1 text-xs text-primary hover:underline"
                  onClick={() => setShowNewManufacturer(true)}
                >
                  <Plus className="h-3 w-3" />
                  Add a new manufacturer
                </button>
              ) : (
                <div className="flex items-center gap-2 rounded-md border bg-muted/30 p-2">
                  <Input
                    autoFocus
                    placeholder="Manufacturer name…"
                    value={newManufacturerName}
                    onChange={(e) => setNewManufacturerName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleCreateManufacturer();
                      if (e.key === 'Escape') {
                        setShowNewManufacturer(false);
                        setNewManufacturerName('');
                      }
                    }}
                    className="h-8 text-sm"
                  />
                  <Button
                    size="sm"
                    className="h-8 shrink-0"
                    onClick={handleCreateManufacturer}
                    disabled={!newManufacturerName.trim() || newManufacturerLoading}
                  >
                    {newManufacturerLoading ? <RefreshCw className="h-3 w-3 animate-spin" /> : 'Create'}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 shrink-0 px-2"
                    onClick={() => {
                      setShowNewManufacturer(false);
                      setNewManufacturerName('');
                    }}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              )}
              {!showNewManufacturer && (
                <p className="text-xs text-muted-foreground">
                  Leave blank to apply this alias to all manufacturers.
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="alias-label">Their Field Label</Label>
              <Input
                id="alias-label"
                placeholder="e.g. Width, Opening Width, Frame Width…"
                value={newAliasLabel}
                onChange={(e) => setNewAliasLabel(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Exactly how this manufacturer labels this field in their estimates.
              </p>
            </div>
          </div>
          <DialogFooter className="mt-6">
            <Button variant="outline" onClick={() => setAddAliasTarget(null)}>
              Cancel
            </Button>
            <Button
              onClick={handleAddAlias}
              disabled={!newAliasLabel.trim() || addAliasLoading}
            >
              {addAliasLoading ? 'Saving…' : 'Save Alias'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Move Manufacturer Alias Dialog */}
      <Dialog open={!!moveAliasTarget} onOpenChange={(open) => !open && setMoveAliasTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display text-2xl">Move Alias to Different Field</DialogTitle>
            <DialogDescription>
              Reassign{' '}
              <span className="font-semibold">&ldquo;{moveAliasTarget?.alias.manufacturerFieldLabel}&rdquo;</span>{' '}
              {moveAliasTarget?.alias.manufacturer?.name ? (
                <>from <span className="font-semibold">{moveAliasTarget.alias.manufacturer.name}</span> </>
              ) : null}
              to a different master field label. Use this when the alias was extracted into the wrong field.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="move-alias-field">Target Field</Label>
              {(() => {
                const available = allFieldDefs.filter(
                  (fd) => fd.id !== moveAliasTarget?.currentFieldDefId
                );
                return available.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No other field definitions available.</p>
                ) : (
                  <Select value={moveAliasNewFieldDefId} onValueChange={setMoveAliasNewFieldDefId}>
                    <SelectTrigger id="move-alias-field">
                      <SelectValue placeholder="Select target field…" />
                    </SelectTrigger>
                    <SelectContent>
                      {available.map((fd) => (
                        <SelectItem key={fd.id} value={fd.id}>
                          <span>{fd.fieldLabel}</span>
                          <span className="ml-1 font-mono text-xs text-muted-foreground">
                            ({fd.fieldKey})
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                );
              })()}
              <p className="text-xs text-muted-foreground">
                The alias will be removed from its current field and associated with the selected field.
              </p>
            </div>
          </div>
          <DialogFooter className="mt-6">
            <Button variant="outline" onClick={() => setMoveAliasTarget(null)}>
              Cancel
            </Button>
            <Button
              onClick={handleMoveAlias}
              disabled={!moveAliasNewFieldDefId || moveAliasLoading}
            >
              {moveAliasLoading ? 'Moving…' : 'Move Alias'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add / Edit Hardware Catalog Item Dialog */}
      <Dialog
        open={catalogDialogMode !== null}
        onOpenChange={(open) => !open && setCatalogDialogMode(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display text-2xl">
              {catalogDialogMode === 'add' ? 'Add Catalog Item' : 'Edit Catalog Item'}
            </DialogTitle>
            <DialogDescription>
              {catalogDialogMode === 'add'
                ? 'Add a new hardware item to the catalog.'
                : `Editing "${catalogEditTarget?.name}".`}
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="catalog-name">Name</Label>
              <Input
                id="catalog-name"
                placeholder="e.g. Hinge - Mechanical SS 4.5×4.5 NRP"
                value={catalogForm.name}
                onChange={(e) => setCatalogForm((f) => ({ ...f, name: e.target.value }))}
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="catalog-code">Canonical Code</Label>
              <Input
                id="catalog-code"
                placeholder="e.g. HW-HINGE-MECH-SS-4545"
                value={catalogForm.canonicalCode}
                onChange={(e) => setCatalogForm((f) => ({ ...f, canonicalCode: e.target.value }))}
                className="font-mono text-sm"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="catalog-subcategory">Subcategory</Label>
              <Select
                value={catalogForm.subcategory}
                onValueChange={(v) =>
                  setCatalogForm((f) => ({ ...f, subcategory: v as HardwareSubcategory }))
                }
              >
                <SelectTrigger id="catalog-subcategory">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HARDWARE_SUBCATEGORIES.map(({ key, label }) => (
                    <SelectItem key={key} value={key}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="catalog-description">Description</Label>
              <Input
                id="catalog-description"
                placeholder="Optional description…"
                value={catalogForm.description}
                onChange={(e) => setCatalogForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="catalog-sort-order">Sort Order</Label>
                <Input
                  id="catalog-sort-order"
                  type="number"
                  min={0}
                  value={catalogForm.sortOrder}
                  onChange={(e) =>
                    setCatalogForm((f) => ({ ...f, sortOrder: parseInt(e.target.value) || 0 }))
                  }
                />
              </div>
              <div className="flex flex-col justify-end space-y-2">
                <Label>Active</Label>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={catalogForm.active}
                    onCheckedChange={(checked) =>
                      setCatalogForm((f) => ({ ...f, active: checked }))
                    }
                  />
                  <span className="text-sm text-muted-foreground">
                    {catalogForm.active ? 'Visible in picker' : 'Hidden from picker'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className="mt-6">
            <Button variant="outline" onClick={() => setCatalogDialogMode(null)}>
              Cancel
            </Button>
            <Button
              onClick={handleCatalogSave}
              disabled={
                catalogFormLoading ||
                !catalogForm.name.trim() ||
                !catalogForm.canonicalCode.trim()
              }
            >
              {catalogFormLoading
                ? 'Saving…'
                : catalogDialogMode === 'add'
                ? 'Add Item'
                : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Hardware Catalog Item Confirmation */}
      <AlertDialog
        open={!!catalogDeleteTarget}
        onOpenChange={() => setCatalogDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete catalog item?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove{' '}
              <span className="font-semibold">
                &ldquo;{catalogDeleteTarget?.name}&rdquo;
              </span>{' '}
              from the hardware catalog. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={catalogDeleteLoading}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleCatalogDelete}
              disabled={catalogDeleteLoading}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {catalogDeleteLoading ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
