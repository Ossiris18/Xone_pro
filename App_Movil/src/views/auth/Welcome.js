import { View, StyleSheet, Image, Text } from "react-native";
import { Button } from "react-native-paper";
import { colors } from "../../constants/theme";

export default function Welcome({ navigation }) {
  return (
    <View style={styles.container}>
      <View style={styles.logoContainer}>
        <Text style={styles.title}>Xone</Text>
        <Text style={styles.subtitle}>Bienvenido</Text>
      </View>

      <View style={styles.buttonContainer}>
        <Button
          mode="contained"
          buttonColor={colors.primary}
          style={styles.button}
          onPress={() => navigation.navigate("Login")}
        >
          Iniciar Sesión
        </Button>

        <Button
          mode="outlined"
          textColor={colors.primary}
          style={styles.buttonOutline}
          onPress={() => navigation.navigate("Register")}
        >
          Registrarse
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: "space-between",
    paddingVertical: 60,
    paddingHorizontal: 30,
  },
  logoContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  title: {
    fontSize: 48,
    fontWeight: "bold",
    color: colors.primary,
  },
  subtitle: {
    fontSize: 18,
    color: colors.textSecondary,
    marginTop: 10,
  },
  buttonContainer: {
    gap: 15,
  },
  button: {
    paddingVertical: 5,
    borderRadius: 8,
  },
  buttonOutline: {
    paddingVertical: 5,
    borderRadius: 8,
    borderColor: colors.primary,
  },
});