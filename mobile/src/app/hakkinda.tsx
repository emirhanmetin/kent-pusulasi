// Hakkında: acil durum, uyarı, veri kaynakları / lisanslar, gizlilik (App Store 5.1.1(i) ve atıf zorunlulukları).
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { webUrl } from '@/lib/api';
import { SYM, type SymbolName } from '@/lib/categories';
import { useTheme, type Theme } from '@/lib/theme';

const SOURCES: { name: string; what: string; license: string; url: string }[] = [
  {
    name: 'İzmir Büyükşehir Belediyesi Açık Veri',
    what: 'Eczane, toplanma alanı, pazar, taksi, Wi-Fi, otopark, hava kalitesi',
    license: 'CC BY 4.0',
    url: 'https://acikveri.bizizmir.com/',
  },
  { name: 'İZSU', what: 'Arıza ve planlı su kesintileri', license: 'Kamuya açık duyurular', url: 'https://www.izsu.gov.tr/' },
  {
    name: 'EPİAŞ Şeffaflık Platformu',
    what: 'Elektrik kesintileri (Gediz Elektrik)',
    license: 'EPİAŞ kullanım koşulları',
    url: 'https://seffaflik.epias.com.tr/',
  },
  {
    name: '© OpenStreetMap katkıcıları',
    what: 'Belediye dışı otoparklar, rota için yol ağı',
    license: 'ODbL',
    url: 'https://www.openstreetmap.org/copyright',
  },
  { name: 'OSRM', what: 'Yol mesafesi ve rota hesabı', license: 'BSD · OpenStreetMap verisi', url: 'https://project-osrm.org/' },
];

export default function About() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const version = Constants.expoConfig?.version ?? '1.0.0';

  return (
    <ScrollView style={{ backgroundColor: theme.sheet }} contentContainerStyle={[styles.wrap, { paddingBottom: insets.bottom + 32 }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: theme.label }]}>Kent Pusulası</Text>
        <Pressable onPress={() => router.back()} hitSlop={10} style={[styles.close, { backgroundColor: theme.fill }]} accessibilityLabel="Kapat">
          <SymbolView name={SYM.close} size={12} weight="bold" tintColor={theme.secondary} />
        </Pressable>
      </View>
      <Text style={[styles.caption, { color: theme.secondary }]}>İzmir · sürüm {version}</Text>

      <Pressable
        onPress={() => Linking.openURL('tel:112')}
        style={({ pressed }) => [styles.emergency, { backgroundColor: theme.red, opacity: pressed ? 0.85 : 1 }]}
        accessibilityRole="button"
        accessibilityLabel="Acil durumda 112'yi ara"
      >
        <SymbolView name={SYM.phone} size={20} tintColor="#ffffff" />
        <View style={{ flex: 1 }}>
          <Text style={styles.emergencyTitle}>Acil durumda 112</Text>
          <Text style={styles.emergencyText}>Dokunarak arayın. Deprem sonrası AFAD ve yetkililerin duyurularını esas alın.</Text>
        </View>
      </Pressable>

      <Group theme={theme} title="Önemli">
        <Text style={[styles.body, { color: theme.label }]}>
          Bilgiler kamu kurumlarının açık verilerinden alınır ve bilgilendirme amaçlıdır; doğruluğu ve güncelliği garanti
          edilmez. Kent Pusulası; İzmir Büyükşehir Belediyesi, İZSU, EPİAŞ veya Gediz Elektrik’in resmî uygulaması değildir.
        </Text>
      </Group>

      <Group theme={theme} title="Veri kaynakları ve lisanslar">
        {SOURCES.map((s, i) => (
          <Row key={s.name} theme={theme} first={i === 0} onPress={() => Linking.openURL(s.url)} title={s.name} sub={`${s.what} · ${s.license}`} />
        ))}
        <Row theme={theme} onPress={() => Linking.openURL('https://www.openstreetmap.org/fixthemap')} title="Haritada hata mı var? Düzeltin" />
      </Group>

      <Group theme={theme} title="Gizlilik">
        <Text style={[styles.body, { color: theme.label }]}>
          Konumunuz yalnızca size en yakın yerleri bulmak için kullanılır ve saklanmaz. Hesap, reklam veya izleme yoktur.
        </Text>
        <Row theme={theme} onPress={() => Linking.openURL(webUrl('gizlilik.html'))} title="Gizlilik politikası" icon={SYM.lock} />
        <Row theme={theme} onPress={() => Linking.openURL(webUrl('kaynaklar.html'))} title="Kaynaklar sayfası" icon={SYM.doc} />
      </Group>
    </ScrollView>
  );
}

function Group({ theme, title, children }: { theme: Theme; title: string; children: React.ReactNode }) {
  return (
    <View style={styles.groupWrap}>
      <Text style={[styles.groupTitle, { color: theme.secondary }]}>{title}</Text>
      <View style={[styles.group, { backgroundColor: theme.group }]}>{children}</View>
    </View>
  );
}

function Row({ theme, title, sub, onPress, first, icon }: { theme: Theme; title: string; sub?: string; onPress: () => void; first?: boolean; icon?: SymbolName }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.separator }, pressed && { backgroundColor: theme.selection }]}
      accessibilityRole="link"
    >
      {!!icon && <SymbolView name={icon} size={16} tintColor={theme.accent} />}
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowTitle, { color: theme.label }]}>{title}</Text>
        {!!sub && <Text style={[styles.rowSub, { color: theme.secondary }]}>{sub}</Text>}
      </View>
      <SymbolView name={SYM.external} size={13} tintColor={theme.tertiary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 16, paddingTop: 20 },
  header: { flexDirection: 'row', alignItems: 'center' },
  title: { flex: 1, fontSize: 30, fontWeight: '700', letterSpacing: -0.5 },
  caption: { fontSize: 14, marginTop: 2 },
  close: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  emergency: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 18, padding: 16, borderRadius: 14 },
  emergencyTitle: { color: '#ffffff', fontSize: 18, fontWeight: '700' },
  emergencyText: { color: 'rgba(255,255,255,0.9)', fontSize: 13.5, marginTop: 2 },
  groupWrap: { marginTop: 24 },
  groupTitle: { fontSize: 13, fontWeight: '600', marginLeft: 4, marginBottom: 6 },
  group: { borderRadius: 12, overflow: 'hidden' },
  body: { fontSize: 14.5, lineHeight: 20, padding: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 11 },
  rowTitle: { fontSize: 15.5 },
  rowSub: { fontSize: 12.5, marginTop: 1 },
});
