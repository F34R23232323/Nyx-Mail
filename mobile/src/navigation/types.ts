import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import type { CompositeScreenProps } from "@react-navigation/native";
import type { FolderType } from "../lib/types";

export type RootStackParamList = {
  Login: undefined;
  Signup: undefined;
  Mfa: undefined;
  Unlock: undefined;
  Main: undefined;
  Thread: { id: string; folderType?: FolderType; subject?: string };
  Account: undefined;
  Appearance: undefined;
  Security: undefined;
  Folders: undefined;
  Labels: undefined;
  Aliases: undefined;
  About: undefined;
};

export type MainTabParamList = {
  Mail: { folder?: string } | undefined;
  Search: undefined;
  Contacts: undefined;
  Settings: undefined;
};

export type RootScreenProps<T extends keyof RootStackParamList> = NativeStackScreenProps<
  RootStackParamList,
  T
>;

export type TabScreenProps<T extends keyof MainTabParamList> = CompositeScreenProps<
  BottomTabScreenProps<MainTabParamList, T>,
  NativeStackScreenProps<RootStackParamList>
>;
