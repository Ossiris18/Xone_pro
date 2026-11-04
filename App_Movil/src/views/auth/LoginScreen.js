import { useState, useEffect, useRef } from "react";
import { ActivityIndicator, Alert, StyleSheet, Text, View } from "react-native";
import { TextInput, TouchableOpacity } from "react-native";
import { colors } from "../../constants/theme";
import { authServices } from "../../services/authServices";
import { validarEmail } from "../../utilities/validaciones";

const LOCKOUT_TIMES = [30, 60, 600, 1800, 3600];

export default function LoginScreen({ navigation }) {
  const [correo, setCorreo] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [intentosFallidos, setIntentosFallidos] = useState(0);
  const [bloqueado, setBloqueado] = useState(false);
  const [tiempoRestante, setTiempoRestante] = useState(0);
  const timerRef = useRef(null);

  const emailValido = validarEmail(correo);

  useEffect(() => {
    if (bloqueado && tiempoRestante > 0) {
      timerRef.current = setInterval(() => {
        setTiempoRestante((prev) => {
          if (prev <= 1) {
            clearInterval(timerRef.current);
            setBloqueado(false);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(timerRef.current);
  }, [bloqueado]);

  function formatTiempo(segundos) {
    if (segundos >= 3600) return `${Math.floor(segundos / 3600)}h`;
    if (segundos >= 60) return `${Math.floor(segundos / 60)}min ${segundos % 60}seg`;
    return `${segundos} segundos`;
  }

  function aplicarBloqueo(intentos) {
    const nivel = Math.min(intentos - 5, LOCKOUT_TIMES.length - 1);
    const tiempo = LOCKOUT_TIMES[nivel];
    setTiempoRestante(tiempo);
    setBloqueado(true);
  }

  const onSubmit = async () => {
    if (bloqueado) return;

    if (!emailValido) {
      Alert.alert("Correo inválido", "Por favor, ingresa un correo electrónico válido.");
      return;
    }
    if (!password.trim()) {
      Alert.alert("Campo requerido", "Completa la contraseña.");
      return;
    }

    setLoading(true);
    const response = await authServices.login(correo.trim(), password);
    setLoading(false);

    if (response.error) {
      const nuevosIntentos = intentosFallidos + 1;
      setIntentosFallidos(nuevosIntentos);

      if (nuevosIntentos >= 5) {
        aplicarBloqueo(nuevosIntentos);
      } else {
        Alert.alert("No se pudo iniciar sesión", response.error);
      }
    } else {
      setIntentosFallidos(0);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Bienvenido de vuelta</Text>
      <Text style={styles.subtitle}>Inicia sesión para continuar con tus reservas.</Text>

      <View style={styles.card}>
        <TextInput
          placeholder="Correo"
          placeholderTextColor={colors.textSecondary}
          keyboardType="email-address"
          autoCapitalize="none"
          value={correo}
          onChangeText={setCorreo}
          style={[styles.input, correo.length > 0 && !emailValido && styles.inputError]}
          editable={!bloqueado}
        />

        <TextInput
          placeholder="Contraseña"
          placeholderTextColor={colors.textSecondary}
          secureTextEntry
          value={password}
          onChangeText={setPassword}
          style={[styles.input, bloqueado && styles.inputError]}
          editable={!bloqueado}
        />

        {bloqueado && (
          <View style={styles.lockContainer}>
            <Text style={styles.lockText}>Demasiados intentos fallidos</Text>
            <Text style={styles.lockTimer}>Espera {formatTiempo(tiempoRestante)}</Text>
          </View>
        )}

        <TouchableOpacity
          style={[styles.primaryButton, bloqueado && styles.disabledButton]}
          onPress={onSubmit}
          disabled={loading || bloqueado}
        >
          {loading ? (
            <ActivityIndicator color={colors.textLight} />
          ) : (
            <Text style={styles.primaryButtonText}>Entrar</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.secondaryButton} onPress={() => navigation.navigate("Register")}>
          <Text style={styles.secondaryButtonText}>Crear cuenta</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: 24,
    paddingTop: 70,
  },
  title: {
    color: colors.text,
    fontSize: 32,
    fontWeight: "800",
  },
  subtitle: {
    color: colors.textSecondary,
    marginTop: 8,
    fontSize: 15,
    marginBottom: 24,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 15,
    padding: 18,
    shadowColor: colors.shadow,
    shadowOpacity: 0.08,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
    gap: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: 15,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.text,
  },
  inputError: {
    borderColor: colors.error,
  },
  lockContainer: {
    backgroundColor: "#fff0f0",
    padding: 12,
    borderRadius: 10,
    alignItems: "center",
  },
  lockText: {
    fontSize: 13,
    color: colors.error,
    fontWeight: "700",
  },
  lockTimer: {
    fontSize: 22,
    color: colors.error,
    fontWeight: "800",
    marginTop: 4,
  },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: 15,
    alignItems: "center",
    paddingVertical: 16,
  },
  primaryButtonText: {
    color: colors.textLight,
    fontWeight: "800",
    fontSize: 16,
  },
  secondaryButton: {
    alignItems: "center",
    paddingVertical: 10,
  },
  secondaryButtonText: {
    color: colors.primary,
    fontWeight: "700",
  },
  disabledButton: {
    opacity: 0.55,
  },
});