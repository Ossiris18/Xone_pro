import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, SafeAreaView, ScrollView, ActivityIndicator } from 'react-native';
import { auth } from '../../config/firebase';
import { colors } from "../../constants/theme";
import { Feather } from '@expo/vector-icons';
import { getUsuarioPorUid, getReservasByUsuario } from '../../services/apiServices';
import { authServices } from '../../services/authServices';
import { useFocusEffect } from '@react-navigation/native';

const PerfilScreen = () => {
  const user = auth.currentUser;
  const [datosExtra, setDatosExtra] = useState(null);
  const [estanciasReales, setEstanciasReales] = useState(0);
  const [loading, setLoading] = useState(true);
  const [eliminando, setEliminando] = useState(false);

  const fetchDatos = useCallback(async () => {
    setLoading(true);
    try {
      if (user?.uid) {
        // Sincronizar primero cualquier reserva de recepción con su CURP o correo
        await authServices.sincronizarCuentaYReservas({ user });
        const datos = await getUsuarioPorUid(user.uid);
        setDatosExtra(datos);

        const listaRes = await getReservasByUsuario(datos?.curp || "", user.uid, user.email || "");
        const noCanceladas = listaRes.filter((r) => r.estado !== "Cancelada");
        setEstanciasReales(noCanceladas.length);
      }
    } catch (e) {
      // Ignorar fallo menor
    } finally {
      setLoading(false);
    }
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      fetchDatos();
    }, [fetchDatos])
  );

  const handleSignOut = async () => {
    const ok = await authServices.logout();
    if (!ok) {
      Alert.alert("Error", "No se pudo cerrar la sesión.");
    }
  };

  const confirmSignOut = () => {
    Alert.alert(
      "Cerrar Sesión",
      "¿Estás seguro de que quieres cerrar tu sesión?",
      [
        { text: "Cancelar", style: "cancel" },
        { text: "Sí, cerrar sesión", onPress: handleSignOut, style: "destructive" },
      ]
    );
  };

  const handleDeleteAccount = async () => {
    setEliminando(true);
    const res = await authServices.eliminarCuenta();
    setEliminando(false);
    if (!res.success) {
      Alert.alert("Atención", res.error || "No se pudo eliminar la cuenta.");
    }
  };

  const confirmDeleteAccount = () => {
    Alert.alert(
      "Eliminar Cuenta y Datos",
      "Al eliminar tu cuenta se cancelarán tus reservas activas, se borrará todo tu historial de viajes, tu CURP y correo de la base de datos, y se cerrará tu sesión de inmediato. ¿Deseas continuar?",
      [
        { text: "Cancelar", style: "cancel" },
        { text: "Sí, eliminar todo", onPress: handleDeleteAccount, style: "destructive" },
      ]
    );
  };

  if (loading || eliminando) {
    return (
      <SafeAreaView style={styles.loadingScreen}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>
          {eliminando ? "Eliminando cuenta, historial y cerrando sesión..." : "Sincronizando perfil..."}
        </Text>
      </SafeAreaView>
    );
  }

  const nombreMostrar = datosExtra?.nombre || user?.displayName || 'Huésped';
  const inicial = nombreMostrar.charAt(0).toUpperCase();
  const esVip = estanciasReales > 5;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarInitial}>{inicial}</Text>
          </View>
          <Text style={styles.userName}>{nombreMostrar}</Text>
          <Text style={styles.userEmail}>{user?.email}</Text>
          <View style={[styles.levelPill, esVip && styles.levelPillVip]}>
            <Text style={[styles.levelText, esVip && styles.levelTextVip]}>
              {esVip ? `★ Miembro Xone VIP (${estanciasReales} estancias)` : `Estancias registradas: ${estanciasReales}`}
            </Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Información Personal Vinculada</Text>

          <View style={styles.dataCard}>
            <View style={styles.dataRow}>
              <Feather name="user" size={18} color={colors.primary} />
              <Text style={styles.dataLabel}>Nombre</Text>
              <Text style={styles.dataValue}>
                {datosExtra?.nombre || user?.displayName || 'No registrado'}
              </Text>
            </View>

            <View style={styles.separator} />

            <View style={styles.dataRow}>
              <Feather name="mail" size={18} color={colors.primary} />
              <Text style={styles.dataLabel}>Correo</Text>
              <Text style={styles.dataValue}>
                {user?.email || 'No registrado'}
              </Text>
            </View>

            <View style={styles.separator} />

            <View style={styles.dataRow}>
              <Feather name="phone" size={18} color={colors.primary} />
              <Text style={styles.dataLabel}>Teléfono</Text>
              <Text style={styles.dataValue}>
                {datosExtra?.telefono || 'Se registra al reservar'}
              </Text>
            </View>

            <View style={styles.separator} />

            <View style={styles.dataRow}>
              <Feather name="credit-card" size={18} color={colors.primary} />
              <Text style={styles.dataLabel}>CURP</Text>
              <Text style={styles.dataValue}>
                {datosExtra?.curp || 'Se registra al reservar'}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Seguridad y Cuenta</Text>

          <View style={styles.menuContainer}>
            <TouchableOpacity style={styles.menuItem} onPress={confirmSignOut}>
              <Feather name="log-out" size={20} color={colors.text} />
              <Text style={styles.menuItemText}>Cerrar Sesión</Text>
            </TouchableOpacity>

            <TouchableOpacity style={[styles.menuItem, styles.deleteButton]} onPress={confirmDeleteAccount}>
              <Feather name="trash-2" size={20} color={colors.error} />
              <Text style={[styles.menuItemText, styles.deleteButtonText]}>Eliminar Cuenta e Historial</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    paddingBottom: 130,
  },
  loadingScreen: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    color: colors.textSecondary,
    fontSize: 14,
  },
  header: {
    alignItems: 'center',
    paddingTop: 48,
    paddingBottom: 28,
    backgroundColor: colors.surface,
    borderBottomLeftRadius: 30,
    borderBottomRightRadius: 30,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 3,
  },
  avatarCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: '#e0f2fe',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontSize: 32,
    fontWeight: '800',
    color: colors.primary,
  },
  userName: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.text,
    marginTop: 12,
  },
  userEmail: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 2,
  },
  levelPill: {
    marginTop: 12,
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
  },
  levelPillVip: {
    backgroundColor: colors.successSoft,
  },
  levelText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  levelTextVip: {
    color: colors.success,
  },
  section: {
    paddingHorizontal: 20,
    marginTop: 24,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.text,
    marginBottom: 12,
  },
  dataCard: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    padding: 16,
    elevation: 2,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
  },
  dataRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 10,
  },
  dataLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
    width: 80,
  },
  dataValue: {
    fontSize: 14,
    color: colors.textSecondary,
    flex: 1,
    textAlign: 'right',
    fontWeight: '500',
  },
  separator: {
    height: 1,
    backgroundColor: '#f1f5f9',
  },
  menuContainer: {
    gap: 12,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    padding: 16,
    borderRadius: 16,
  },
  menuItemText: {
    fontSize: 15,
    fontWeight: '700',
    marginLeft: 14,
    color: colors.text,
  },
  deleteButton: {
    backgroundColor: '#fef2f2',
  },
  deleteButtonText: {
    color: colors.error,
  },
});

export default PerfilScreen;
