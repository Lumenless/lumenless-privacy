import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import PayLinksScreen from '../screens/PayLinksScreen';
import PayLinkDetailsScreen from '../screens/PayLinkDetailsScreen';
import { PayLink } from '../services/paylink';

export type RootStackParamList = {
  PayLinks: undefined;
  PayLinkDetails: { payLink: PayLink };
};

const Stack = createStackNavigator<RootStackParamList>();

export default function AppNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          cardStyle: { backgroundColor: '#08080c' },
        }}
      >
        <Stack.Screen name="PayLinks" component={PayLinksScreen} />
        <Stack.Screen name="PayLinkDetails" component={PayLinkDetailsScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
