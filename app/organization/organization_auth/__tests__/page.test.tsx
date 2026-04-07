/** @jest-environment jsdom */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import OrganizationAuthPage from "@/app/organization/organization_auth/page";
import { signInOrganizationAdmin } from "@/lib/organization-auth";

const mockPush = jest.fn();
const mockRefresh = jest.fn();

jest.mock("next/navigation", () => ({
    useRouter: () => ({
        push: mockPush,
        refresh: mockRefresh,
    }),
}));

jest.mock("@/lib/organization-auth", () => ({
    signInOrganizationAdmin: jest.fn(),
}));

describe("OrganizationAuthPage", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("shows validation error when email/password are empty", async () => {
        render(<OrganizationAuthPage />);

        await userEvent.click(screen.getByRole("button", { name: /sign in to organization panel/i }));

        expect(screen.getByText("Email and password are required.")).toBeInTheDocument();
        expect(signInOrganizationAdmin).not.toHaveBeenCalled();
    });

    it("shows auth failure message from backend", async () => {
        (signInOrganizationAdmin as jest.Mock).mockResolvedValue({ success: false, message: "Invalid credentials" });
        render(<OrganizationAuthPage />);

        await userEvent.type(screen.getByLabelText(/email address/i), "org@test.com");
        await userEvent.type(screen.getByLabelText(/^password$/i), "wrong");
        await userEvent.click(screen.getByRole("button", { name: /sign in to organization panel/i }));

        expect(screen.getByText("Invalid credentials")).toBeInTheDocument();
    });

    it("navigates to organization dashboard on successful sign in", async () => {
        (signInOrganizationAdmin as jest.Mock).mockResolvedValue({ success: true });
        render(<OrganizationAuthPage />);

        await userEvent.type(screen.getByLabelText(/email address/i), "org@test.com");
        await userEvent.type(screen.getByLabelText(/^password$/i), "strong-pass");
        await userEvent.click(screen.getByRole("button", { name: /sign in to organization panel/i }));

        expect(mockPush).toHaveBeenCalledWith("/organization");
        expect(mockRefresh).toHaveBeenCalled();
    });
});
