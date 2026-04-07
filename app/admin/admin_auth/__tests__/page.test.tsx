/** @jest-environment jsdom */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AdminAuthPage from "@/app/admin/admin_auth/page";
import { signInAdmin } from "@/lib/admin-auth";

const mockPush = jest.fn();
const mockRefresh = jest.fn();

jest.mock("next/navigation", () => ({
    useRouter: () => ({
        push: mockPush,
        refresh: mockRefresh,
    }),
}));

jest.mock("@/lib/admin-auth", () => ({
    signInAdmin: jest.fn(),
}));

describe("AdminAuthPage", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        sessionStorage.clear();
    });

    it("shows validation error when form is empty", async () => {
        render(<AdminAuthPage />);

        await userEvent.click(screen.getByRole("button", { name: /sign in to admin panel/i }));

        expect(screen.getByText("Email and password are required.")).toBeInTheDocument();
        expect(signInAdmin).not.toHaveBeenCalled();
    });

    it("sets temporary session flag when keep signed in is disabled", async () => {
        (signInAdmin as jest.Mock).mockResolvedValue({ success: true });
        render(<AdminAuthPage />);

        await userEvent.type(screen.getByLabelText(/email address/i), "admin@test.com");
        await userEvent.type(screen.getByLabelText(/^password$/i), "strong-pass");
        await userEvent.click(screen.getByLabelText(/keep me signed in/i));
        await userEvent.click(screen.getByRole("button", { name: /sign in to admin panel/i }));

        expect(sessionStorage.getItem("admin_temp_session")).toBe("true");
        expect(mockPush).toHaveBeenCalledWith("/admin");
    });
});
