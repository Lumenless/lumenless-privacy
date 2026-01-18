import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { LumenScreen, PayLinksScreen } from '../screens';
import { CustomTabBar } from '../components';

const Tab = createBottomTabNavigator();

export default function TabNavigator() {
  return (
    <Tab.Navigator
      tabBar={(props) => <CustomTabBar {...props} />}
      screenOptions={{
        headerShown: false,
      }}
    >
      <Tab.Screen name="Lumen" component={LumenScreen} />
      <Tab.Screen name="PayLinks" component={PayLinksScreen} />
    </Tab.Navigator>
  );
}
