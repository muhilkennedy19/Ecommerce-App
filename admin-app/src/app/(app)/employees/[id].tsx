import {
  deleteImage,
  getEmployee,
  hasPermission,
  putImage,
  updateEmployee,
  type Employee,
} from '@common';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { Image } from 'expo-image';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { Badge, Button, Card, DANGER, EmptyState, Screen, SectionTitle, SUCCESS, TextField } from '@/components/kit';
import { useToast } from '@/components/feedback';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useCachedImage } from '@/hooks/use-cached-image';
import { useAuth } from '@/lib/auth';
import { useT } from '@/lib/i18n';

const ORANGE = '#F5A623';

/** Resize + JPEG-compress a local image to a base64 string (no data-URI prefix). */
async function compressToBase64(uri: string): Promise<string> {
  const ctx = ImageManipulator.manipulate(uri);
  ctx.resize({ width: 1000 });
  const ref = await ctx.renderAsync();
  const out = await ref.saveAsync({ compress: 0.5, format: SaveFormat.JPEG, base64: true });
  if (!out.base64) throw new Error('Could not process the selected image.');
  return out.base64;
}

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Parse a stored 'yyyy-mm-dd' into a local-time Date (avoids the UTC off-by-one). */
function parseLocalDate(iso: string): Date | null {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  return new Date(y, m - 1, d);
}

export default function EmployeeDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { appUser } = useAuth();
  const t = useT();
  const toast = useToast();
  const role = appUser?.role;
  const canWrite = hasPermission(role, 'employees.write');
  const canRead = hasPermission(role, 'employees.read');

  const [employee, setEmployee] = useState<Employee | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const [name, setName] = useState('');
  const [dob, setDob] = useState('');
  const [address, setAddress] = useState('');
  const [photoImageId, setPhotoImageId] = useState<string | null>(null);
  const [proofImageId, setProofImageId] = useState<string | null>(null);

  const [showDob, setShowDob] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [uploadingProof, setUploadingProof] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!canRead) return;
    let active = true;
    setLoading(true);
    setLoadError(false);
    getEmployee(id)
      .then((emp) => {
        if (!active) return;
        setEmployee(emp);
        if (emp) {
          setName(emp.name ?? '');
          setDob(emp.dob ?? '');
          setAddress(emp.address ?? '');
          setPhotoImageId(emp.photoImageId ?? null);
          setProofImageId(emp.proofImageId ?? null);
        }
      })
      .catch(() => {
        if (active) setLoadError(true);
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [id, canRead]);

  const photoUri = useCachedImage(photoImageId);

  async function pickPhoto() {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.6 });
    const uri = res.assets?.[0]?.uri;
    if (!uri) return;
    setUploadingPhoto(true);
    try {
      const base64 = await compressToBase64(uri);
      const newId = await putImage(base64, 'image/jpeg');
      const old = photoImageId;
      setPhotoImageId(newId);
      if (old && old !== newId) await deleteImage(old).catch(() => {});
    } catch (e) {
      toast({ type: 'error', title: t('employee.uploadFailed', 'Upload failed'), message: e instanceof Error ? e.message : String(e) });
    } finally {
      setUploadingPhoto(false);
    }
  }

  async function pickProof() {
    const res = await DocumentPicker.getDocumentAsync({});
    const asset = res.assets?.[0];
    if (!asset?.uri) return;
    setUploadingProof(true);
    try {
      const mime = asset.mimeType ?? 'image/jpeg';
      const base64 = mime.startsWith('image/')
        ? await compressToBase64(asset.uri)
        : await FileSystem.readAsStringAsync(asset.uri, {
            encoding: FileSystem.EncodingType.Base64,
          });
      const newId = await putImage(base64, mime);
      const old = proofImageId;
      setProofImageId(newId);
      if (old && old !== newId) await deleteImage(old).catch(() => {});
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({
        type: 'error',
        title: t('employee.uploadFailed', 'Upload failed'),
        message: t('employee.proofTip', '{msg}\n\nTip: a PDF can easily exceed the size limit — try a smaller or clearer photo of the document instead.', { msg }),
      });
    } finally {
      setUploadingProof(false);
    }
  }

  function buildPatch(): Partial<Employee> {
    return {
      name: name.trim(),
      dob: dob || null,
      address: address.trim() || null,
      photoImageId: photoImageId || null,
      proofImageId: proofImageId || null,
    };
  }

  async function onSave() {
    if (!name.trim()) {
      toast({ type: 'error', title: t('employee.missingName', 'Missing name'), message: t('employee.missingNameHint', 'Please enter a name.') });
      return;
    }
    setSaving(true);
    try {
      await updateEmployee(id, buildPatch());
      router.back();
    } catch (e) {
      toast({ type: 'error', title: t('common.saveFailed', 'Save failed'), message: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  }

  async function setStatus(status: Employee['status']) {
    try {
      await updateEmployee(id, { status });
      setEmployee((prev) => (prev ? { ...prev, status } : prev));
    } catch (e) {
      toast({ type: 'error', title: t('common.updateFailed', 'Update failed'), message: e instanceof Error ? e.message : String(e) });
    }
  }

  const detailsPresent = !!name.trim() && !!dob && !!address.trim();

  async function completeOnboarding() {
    if (!detailsPresent) return;
    setSaving(true);
    try {
      await updateEmployee(id, { ...buildPatch(), status: 'active' });
      router.back();
    } catch (e) {
      toast({ type: 'error', title: t('employee.onboardingFailed', 'Onboarding failed'), message: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  }

  if (!canRead) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('employee.title', 'Employee') }} />
        <EmptyState title={t('common.noAccess', 'No access')} hint={t('employees.noViewHint', "Your role can't view employees.")} />
      </Screen>
    );
  }

  if (loading) {
    return (
      <Screen scroll={false} style={{ justifyContent: 'center', alignItems: 'center' }}>
        <Stack.Screen options={{ title: t('employee.title', 'Employee') }} />
        <ActivityIndicator />
      </Screen>
    );
  }

  if (loadError) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('employee.title', 'Employee') }} />
        <EmptyState title={t('employee.loadErrorTitle', "Couldn't load employee")} hint={t('employee.loadErrorHint', 'Something went wrong. Please try again.')} />
      </Screen>
    );
  }

  if (!employee) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('employee.title', 'Employee') }} />
        <EmptyState title={t('employee.notFound', 'Not found')} hint={t('employee.notFoundHint', 'This employee no longer exists.')} />
      </Screen>
    );
  }

  const statusColor =
    employee.status === 'active' ? SUCCESS : employee.status === 'disabled' ? DANGER : ORANGE;

  return (
    <Screen>
      <Stack.Screen options={{ title: employee.name || t('employee.title', 'Employee') }} />
      {/* Stack title falls back to the localized "Employee" when no name is set yet. */}

      <Card style={{ alignItems: 'center', gap: Spacing.two }}>
        {photoUri ? (
          <Image
            source={{ uri: photoUri }}
            style={{ width: 96, height: 96, borderRadius: 48 }}
            contentFit="cover"
          />
        ) : (
          <View
            style={{
              width: 96,
              height: 96,
              borderRadius: 48,
              backgroundColor: statusColor + '22',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <ThemedText type="title" style={{ fontSize: 32, lineHeight: 36 }}>
              {(employee.name || '?').slice(0, 1).toUpperCase()}
            </ThemedText>
          </View>
        )}
        <Badge label={t(`employees.status.${employee.status}`, employee.status)} color={statusColor} />
      </Card>

      {canWrite && employee.onboardingToken && employee.status === 'invited' ? (
        <Card>
          <ThemedText type="smallBold">{t('employee.onboardingToken', 'Onboarding token (dev)')}</ThemedText>
          <ThemedText type="code">{employee.onboardingToken}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {t('employee.onboardingTokenHint', 'Share with the employee until server-side email delivery is available.')}
          </ThemedText>
        </Card>
      ) : null}

      <SectionTitle>{t('employee.profile', 'Profile')}</SectionTitle>
      <Card>
        <TextField
          label={t('employees.name', 'Name')}
          value={name}
          onChangeText={setName}
          editable={canWrite}
          placeholder={t('employees.fullName', 'Full name')}
        />
        <TextField label={t('employees.email', 'Email')} value={employee.email} editable={false} />

        <View style={{ gap: Spacing.one }}>
          <ThemedText type="small" themeColor="textSecondary">
            {t('employee.dob', 'Date of birth')}
          </ThemedText>
          {canWrite ? (
            <Button
              title={dob || t('employee.selectDate', 'Select date')}
              variant="secondary"
              onPress={() => setShowDob(true)}
            />
          ) : (
            <ThemedText>{dob || '—'}</ThemedText>
          )}
          {showDob ? (
            <DateTimePicker
              value={parseLocalDate(dob) ?? new Date(2000, 0, 1)}
              mode="date"
              onChange={(event, date) => {
                setShowDob(false);
                if (event.type === 'set' && date) setDob(toISODate(date));
              }}
            />
          ) : null}
        </View>

        <TextField
          label={t('employee.address', 'Address')}
          value={address}
          onChangeText={setAddress}
          editable={canWrite}
          placeholder={t('employee.homeAddress', 'Home address')}
          multiline
          numberOfLines={3}
          style={{ minHeight: 72, textAlignVertical: 'top' }}
        />
      </Card>

      {canWrite ? (
        <>
          <SectionTitle>{t('employee.documents', 'Documents')}</SectionTitle>
          <Card>
            <Button
              title={photoImageId ? t('employee.replacePhoto', 'Replace photo') : t('employee.uploadPhoto', 'Upload photo')}
              variant="secondary"
              loading={uploadingPhoto}
              onPress={() => void pickPhoto()}
            />
            <Button
              title={proofImageId ? t('employee.replaceProof', 'Replace proof document') : t('employee.uploadProof', 'Upload proof document')}
              variant="secondary"
              loading={uploadingProof}
              onPress={() => void pickProof()}
            />
            {proofImageId ? (
              <ThemedText type="small" themeColor="textSecondary">
                {t('employee.proofAttached', 'Proof document attached ✓')}
              </ThemedText>
            ) : null}
          </Card>

          <SectionTitle>{t('employee.status', 'Status')}</SectionTitle>
          <Card style={{ flexDirection: 'row', gap: Spacing.two }}>
            <View style={{ flex: 1 }}>
              <Button title={t('employee.setActive', 'Set active')} onPress={() => void setStatus('active')} />
            </View>
            <View style={{ flex: 1 }}>
              <Button title={t('employee.disable', 'Disable')} variant="danger" onPress={() => void setStatus('disabled')} />
            </View>
          </Card>

          <Button title={t('common.save', 'Save')} loading={saving} onPress={() => void onSave()} />
          {employee.status !== 'active' ? (
            <Button
              title={t('employee.completeOnboarding', 'Complete onboarding')}
              variant="secondary"
              disabled={!detailsPresent || saving}
              onPress={() => void completeOnboarding()}
            />
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}
