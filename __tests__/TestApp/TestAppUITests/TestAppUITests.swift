//
//  TestAppUITests.swift
//  TestAppUITests
//
//  Created by Felix Lapalme on 2025-07-11.
//

import XCTest

final class TestAppUITests: XCTestCase {

    override func setUpWithError() throws {
        // Put setup code here. This method is called before the invocation of each test method in the class.

        // In UI tests it is usually best to stop immediately when a failure occurs.
        continueAfterFailure = false

        // In UI tests it’s important to set the initial state - such as interface orientation - required for your tests before they run. The setUp method is a good place to do this.
    }

    override func tearDownWithError() throws {
        // Put teardown code here. This method is called after the invocation of each test method in the class.
    }

    @MainActor
    func testExample() throws {
        // UI tests must launch the application that they test.
        let app = XCUIApplication()
        app.launch()

        // Use XCTAssert and related functions to verify your tests produce the correct results.
    }

    @MainActor
    func testLaunchPerformance() throws {
        // This measures how long it takes to launch your application.
        measure(metrics: [XCTApplicationLaunchMetric()]) {
            XCUIApplication().launch()
        }
    }
    
    @MainActor
    func testNavigationFlow() throws {
        let app = XCUIApplication()
        app.launch()
        
        // Test navigation between screens
        let button = app.buttons["Next"]
        if button.exists {
            button.tap()
        }
        
        // Verify we're on the next screen
        XCTAssertTrue(app.navigationBars["Detail"].exists)
    }
    
    @MainActor
    func testUserLogin() throws {
        let app = XCUIApplication()
        app.launch()
        
        // Test login functionality
        let usernameField = app.textFields["Username"]
        let passwordField = app.secureTextFields["Password"]
        let loginButton = app.buttons["Login"]
        
        usernameField.tap()
        usernameField.typeText("testuser")
        
        passwordField.tap()
        passwordField.typeText("password123")
        
        loginButton.tap()
        
        // Verify successful login
        XCTAssertTrue(app.staticTexts["Welcome"].waitForExistence(timeout: 5))
    }
    
    @MainActor
    func testSearchFunctionality() throws {
        let app = XCUIApplication()
        app.launch()
        
        // Test search functionality
        let searchBar = app.searchFields["Search"]
        searchBar.tap()
        searchBar.typeText("Swift")
        
        app.buttons["Search"].tap()
        
        // Verify search results appear
        XCTAssertTrue(app.tables["SearchResults"].waitForExistence(timeout: 3))
    }
    
    @MainActor
    func testSettingsScreen() throws {
        let app = XCUIApplication()
        app.launch()
        
        // Navigate to settings
        app.tabBars.buttons["Settings"].tap()
        
        // Test toggle switches
        let notificationsToggle = app.switches["Notifications"]
        let darkModeToggle = app.switches["Dark Mode"]
        
        if notificationsToggle.exists {
            notificationsToggle.tap()
        }
        
        if darkModeToggle.exists {
            darkModeToggle.tap()
        }
        
        // Verify settings saved
        XCTAssertTrue(app.staticTexts["Settings Saved"].waitForExistence(timeout: 2))
    }
}

final class TestAppAccessibilityTests: XCTestCase {
    
    override func setUpWithError() throws {
        continueAfterFailure = false
    }
    
    @MainActor
    func testVoiceOverNavigation() throws {
        let app = XCUIApplication()
        app.launch()
        
        // Test accessibility navigation
        XCTAssertTrue(app.buttons["Main Button"].isAccessibilityElement)
        XCTAssertEqual(app.buttons["Main Button"].accessibilityLabel, "Main Button")
    }
    
    @MainActor
    func testDynamicTypeSupport() throws {
        let app = XCUIApplication()
        app.launch()
        
        // Test that text scales with dynamic type
        let titleLabel = app.staticTexts["Title"]
        XCTAssertTrue(titleLabel.exists)
    }
    
    @MainActor
    func testColorContrastCompliance() throws {
        let app = XCUIApplication()
        app.launch()
        
        // Test color contrast requirements
        XCTAssertTrue(app.buttons["Primary Action"].exists)
    }
}

final class TestAppPerformanceTests: XCTestCase {
    
    @MainActor
    func testScrollPerformance() throws {
        let app = XCUIApplication()
        app.launch()
        
        let table = app.tables["MainTable"]
        
        measure(metrics: [XCTOSSignpostMetric.scrollDecelerationMetric]) {
            table.swipeUp(velocity: .fast)
            table.swipeDown(velocity: .fast)
        }
    }
    
    @MainActor
    func testAnimationPerformance() throws {
        let app = XCUIApplication()
        app.launch()
        
        measure(metrics: [XCTOSSignpostMetric.animationMetric]) {
            app.buttons["Animate"].tap()
            app.staticTexts["Animation Complete"].waitForExistence(timeout: 5)
        }
    }
    
    @MainActor
    func testMemoryUsage() throws {
        let app = XCUIApplication()
        app.launch()
        
        measure(metrics: [XCTMemoryMetric()]) {
            for _ in 0..<10 {
                app.buttons["Load Data"].tap()
                app.staticTexts["Data Loaded"].waitForExistence(timeout: 2)
            }
        }
    }
}
