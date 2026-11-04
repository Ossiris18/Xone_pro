import { useState, useEffect } from "react";
import * as Location from "expo-location";
import { Alert, Linking } from "react-native";

export function useLocation() {
  const [ubicacion, setUbicacion] = useState(null);
  const [permisoOtorgado, setPermisoOtorgado] = useState(null);
  const [cargando, setCargando] = useState(false);

  useEffect(() => {
    solicitarPermiso();
  }, []);

  const solicitarPermiso = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      setPermisoOtorgado(status === "granted");

      if (status === "granted") {
        await obtenerUbicacion();
      }
    } catch (error) {
      console.log("Error solicitando permiso:", error);
      setPermisoOtorgado(false);
    }
  };

  const obtenerUbicacion = async () => {
    try {
      setCargando(true);
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setUbicacion({
        lat: loc.coords.latitude,
        lng: loc.coords.longitude,
      });
    } catch (error) {
      console.log("Error obteniendo ubicación:", error);
      setUbicacion(null);
    } finally {
      setCargando(false);
    }
  };

  const abrirConfiguracion = () => {
    Alert.alert(
      "Ubicación desactivada",
      "Para ver hoteles cercanos activa tu ubicación en Configuración.",
      [
        { text: "Cancelar", style: "cancel" },
        { text: "Abrir Configuración", onPress: () => Linking.openSettings() },
      ]
    );
  };

  const reintentarUbicacion = async () => {
    const { status } = await Location.getForegroundPermissionsAsync();
    if (status === "granted") {
      await obtenerUbicacion();
    } else {
      abrirConfiguracion();
    }
  };

  return {
    ubicacion,
    permisoOtorgado,
    cargando,
    reintentarUbicacion,
  };
}