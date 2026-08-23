package response

import "net/http"

// Menu and catalogue failures.
const (
	ErrCodeCategoryNotFound     ErrorCode = "TX_MNU_001"
	ErrCodeCategoryNameTaken    ErrorCode = "TX_MNU_002"
	ErrCodeCategoryHasItems     ErrorCode = "TX_MNU_003"
	ErrCodeCategoryCreateFailed ErrorCode = "TX_MNU_004"
	ErrCodeCategoryUpdateFailed ErrorCode = "TX_MNU_005"

	ErrCodeMenuItemNotFound     ErrorCode = "TX_MNU_010"
	ErrCodeMenuItemNameTaken    ErrorCode = "TX_MNU_011"
	ErrCodeMenuItemCreateFailed ErrorCode = "TX_MNU_012"
	ErrCodeMenuItemUpdateFailed ErrorCode = "TX_MNU_013"
	ErrCodeMenuFetchFailed      ErrorCode = "TX_MNU_014"
	ErrCodeInvalidFoodType      ErrorCode = "TX_MNU_015"
	ErrCodeInvalidSpiceLevel    ErrorCode = "TX_MNU_016"
	ErrCodeInvalidPrice         ErrorCode = "TX_MNU_017"
	ErrCodeMenuItemUnavailable  ErrorCode = "TX_MNU_018"
)

var (
	ErrCategoryNotFound = &ApplicationError{
		ErrorCode:    ErrCodeCategoryNotFound,
		ErrorMessage: "menu category not found",
		HttpCode:     http.StatusNotFound,
	}
	ErrCategoryNameTaken = &ApplicationError{
		ErrorCode:    ErrCodeCategoryNameTaken,
		ErrorMessage: "a category with this name already exists",
		HttpCode:     http.StatusConflict,
	}
	// ErrCategoryHasItems blocks deleting a category that still holds dishes, rather than
	// cascading. Cascading here would delete menu items that order history references.
	ErrCategoryHasItems = &ApplicationError{
		ErrorCode:    ErrCodeCategoryHasItems,
		ErrorMessage: "move or remove the items in this category first",
		HttpCode:     http.StatusConflict,
	}
	ErrCategoryCreateFailed = &ApplicationError{
		ErrorCode:    ErrCodeCategoryCreateFailed,
		ErrorMessage: "failed to create category",
		HttpCode:     http.StatusInternalServerError,
	}
	ErrCategoryUpdateFailed = &ApplicationError{
		ErrorCode:    ErrCodeCategoryUpdateFailed,
		ErrorMessage: "failed to update category",
		HttpCode:     http.StatusInternalServerError,
	}

	ErrMenuItemNotFound = &ApplicationError{
		ErrorCode:    ErrCodeMenuItemNotFound,
		ErrorMessage: "menu item not found",
		HttpCode:     http.StatusNotFound,
	}
	ErrMenuItemNameTaken = &ApplicationError{
		ErrorCode:    ErrCodeMenuItemNameTaken,
		ErrorMessage: "an item with this name already exists in this category",
		HttpCode:     http.StatusConflict,
	}
	ErrMenuItemCreateFailed = &ApplicationError{
		ErrorCode:    ErrCodeMenuItemCreateFailed,
		ErrorMessage: "failed to create menu item",
		HttpCode:     http.StatusInternalServerError,
	}
	ErrMenuItemUpdateFailed = &ApplicationError{
		ErrorCode:    ErrCodeMenuItemUpdateFailed,
		ErrorMessage: "failed to update menu item",
		HttpCode:     http.StatusInternalServerError,
	}
	ErrMenuFetchFailed = &ApplicationError{
		ErrorCode:    ErrCodeMenuFetchFailed,
		ErrorMessage: "failed to load the menu",
		HttpCode:     http.StatusInternalServerError,
	}
	ErrInvalidFoodType = &ApplicationError{
		ErrorCode:    ErrCodeInvalidFoodType,
		ErrorMessage: "food type must be one of veg, non_veg, egg",
		HttpCode:     http.StatusUnprocessableEntity,
	}
	ErrInvalidSpiceLevel = &ApplicationError{
		ErrorCode:    ErrCodeInvalidSpiceLevel,
		ErrorMessage: "spice level must be one of mild, medium, hot",
		HttpCode:     http.StatusUnprocessableEntity,
	}
	ErrInvalidPrice = &ApplicationError{
		ErrorCode:    ErrCodeInvalidPrice,
		ErrorMessage: "price must be zero or more",
		HttpCode:     http.StatusUnprocessableEntity,
	}
	// ErrMenuItemUnavailable fires when a diner's cart contains something the kitchen ran
	// out of between page load and checkout. The menu page is cached and the diner may
	// have had it open for twenty minutes, so this is an ordinary case, not an edge one.
	ErrMenuItemUnavailable = &ApplicationError{
		ErrorCode:    ErrCodeMenuItemUnavailable,
		ErrorMessage: "one or more items in your cart are no longer available",
		HttpCode:     http.StatusConflict,
	}
)
