import type { Metadata } from "next";
import { NotificationsSettings } from "./NotificationsSettings";

export const metadata: Metadata = {
	title: "Notification Settings — LEADR Screen Recorder",
};

export default function NotificationsSettingsPage() {
	return <NotificationsSettings />;
}
